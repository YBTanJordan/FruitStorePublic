// This is the Express/Node backend API server for the fruit store app.
// The frontend calls these routes using fetch(), and this server reads/writes data in PostgreSQL.
// Comments are intentionally detailed so a beginner can understand what each route and SQL query is doing.
//#region Imports
import express from 'express';
import cors from 'cors';
import { Pool } from 'pg';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
//#endregion

//#region Express app, environment, and database setup
// Creates the Express application object. All API routes are attached to this app.
const app = express(); 

// Loads environment variables from .env during local development, such as DATABASE_URL and JWT_SECRET.
dotenv.config();

// Creates a PostgreSQL connection pool.
// A pool reuses database connections instead of opening a brand-new connection for every request.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } 
});

//#endregion

//#region TypeScript request types
// Extends the normal Express Request type so TypeScript knows req.user can exist after JWT authentication.
interface AuthenticatedRequest extends express.Request {
  user?: {
    userId: number;
    username: string;
    role: string;
  } | undefined;
}

// Standard shape for any cart/order item received by checkout-related routes.
// Both normal checkout and AI checkout only need the fruit id and requested quantity.
interface OrderRequestItem {
  id: string;
  quantity: number;
}

// Standard shape returned after an order is successfully created.
interface CreatedOrder {
  orderId: string;
  totalAmount: number;
  items: Array<{
    orderItemId: string;
    orderId: string;
    fruitId: string;
    name: string;
    priceAtPurchase: number;
    quantity: number;
  }>;
}
//#endregion

//#region CORS, JSON middleware, and JWT setup
// Only these frontend URLs are allowed to call the API from a browser.
// This is part of CORS protection.
const allowedOrigins = [
  'https://fruit-store-public.vercel.app',
  'http://localhost:5173'
];

// Enables CORS, which lets the deployed React frontend call this backend safely.
app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true
}));

// Lets Express read JSON request bodies, for example { username, password }.
app.use(express.json());

// Secret key used to sign and verify login tokens. Without this, sessions cannot be trusted.
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is missing from environment variables');
}
//#endregion

//#region Reusable SQL snippets and database helpers
// This SQL snippet is reused by both owner order history and customer order history.
// It combines many OrderItem rows into one JSON array called "items" for each order.
const ORDER_ITEMS_JSON_SQL = `
  COALESCE(
    json_agg(
      json_build_object(
        'orderItemId', oi."orderItemId",
        'fruitId', oi."fruitId",
        'name', oi."name",
        'priceAtPurchase', oi."priceAtPurchase",
        'quantity', oi."quantity"
      )
    ) FILTER (WHERE oi."orderItemId" IS NOT NULL),
    '[]'
  ) AS items
`;

// Reusable query for active fruits. This prevents repeating the same SELECT query in AI/cart logic.
const getActiveFruits = async () => {
  const result = await pool.query(
    'SELECT "id", "name", "price", "stock" FROM "Fruit" WHERE "isActive" = TRUE ORDER BY "name"'
  );

  return result.rows;
};
//#endregion

//#region Authentication routes
// POST /api/auth/register
// Creates a new user account. The password is hashed before saving, so the plain password is not stored in the database.
app.post('/api/auth/register', async (req, res) => {
  const {username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }

  try {
    // SQL explanation: this query reads rows from the database. SELECT chooses columns, FROM chooses the table, WHERE filters rows, and ORDER BY controls sorting.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    const userCheck = await pool.query('SELECT * FROM "User" WHERE username = $1', [username]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: 'username already taken' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const userRole = 'customer';

    // SQL explanation: this query creates new database rows. INSERT INTO chooses the table/columns, VALUES provides the data, and RETURNING asks PostgreSQL to send the saved row back.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    const result = await pool.query(
      'INSERT INTO "User" (username, password, role) VALUES ($1, $2, $3) RETURNING id, username, role', [username, hashedPassword, userRole]
    );

    res.status(201).json({ message: 'User registered successfully!', user: result.rows[0]});
  } catch (error){
    console.error(error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
// Checks username/password, then returns a JWT token that proves the user is logged in on future requests.
app.post('/api/auth/login', async(req, res) => {
  const {username, password, role} = req.body;
  try {
    // SQL explanation: this query reads rows from the database. SELECT chooses columns, FROM chooses the table, WHERE filters rows, and ORDER BY controls sorting.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    const result = await pool.query('SELECT * FROM "User" WHERE username = $1', [username]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid username or password'});
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid username or password'});
    }

    if (role && user.role !== role) {
      return res.status(401).json({ error: 'Invalid username or password'});
    }

    const token = jwt.sign(
      { userId: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      {expiresIn: '24h'}
    );

    res.json({
      token, 
      user: {
        id: user.id, 
        username: user.username, 
        role: user.role,
        cart: user.cart || []
      }
    });
  } catch (error){
    console.error(error);
    res.status(500).json({ error: 'Login failed'});
  }
});

//#endregion

//#region Authentication and role middleware
// Reads the Bearer token from the Authorization header.
// Example header: Authorization: Bearer abc123
const getTokenFromRequest = (req: express.Request) => {
  const authHeader = req.headers['authorization'];
  return authHeader && authHeader.split(' ')[1];
};

// Verifies a JWT token and returns the decoded user data.
// This keeps jwt.verify() logic in one place instead of repeating it in multiple middleware functions.
const verifyToken = (token: string) => {
  return jwt.verify(token, JWT_SECRET) as AuthenticatedRequest['user'];
};

// Middleware for protected routes.
// It requires a valid JWT token, then places the decoded user details into req.user.
const authenticateToken = (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    return res.status(401).json({ error: 'Access denied. No session token provided'});
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(403).json({ error: 'Session expired or invalid token' });
  }
};

// Similar to authenticateToken, but login is optional.
// Used for checkout because guests can checkout, but logged-in customers should have their userId attached to the order.
const optionalAuthenticateToken = (req: AuthenticatedRequest, res: express.Response, next: express.NextFunction) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    next();
    return;
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    return res.status(403).json({ error: 'Session expired or invalid token' });
  }
};

// Middleware factory for owner-only or customer-only routes.
// Example: requireRole('owner') blocks customers from owner dashboards and stock management.
const requireRole = (role: 'owner' | 'customer'): express.RequestHandler => {
  return (req, res, next) => {
    const authenticatedReq = req as AuthenticatedRequest;

    if (authenticatedReq.user?.role !== role) {
      const errorMessage = role === 'owner'
        ? 'Access denied. Owners only'
        : 'Access denied. Customers only';

      return res.status(403).json({ error: errorMessage });
    }

    next();
  };
};
//#endregion

//#region Customer cart and fruit catalogue routes
// POST /api/cart/sync
// Saves the logged-in customer's current cart into the User table so it can be restored later.
app.post('/api/cart/sync', authenticateToken, async (req: AuthenticatedRequest, res) => {
  const { cart } = req.body;
  const userId = req.user?.userId;

  if (!Array.isArray(cart)) {
    return res.status(400).json({ error: 'Invalid cart format'});
  }

  try {
    // SQL explanation: this query changes existing rows. UPDATE chooses the table, SET changes columns, WHERE chooses which row(s), and RETURNING sends changed rows back if used.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    await pool.query(
      'UPDATE "User" SET "cart" = $1 WHERE "id" = $2', [JSON.stringify(cart), userId]
    );
    res.json({ message: 'Database cart synchronized successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to persist cart data to profile"});
  }
})

// API Endpoint: Exposes current catalog list data to frontend lookup hooks
// GET /api/fruits
// Returns active fruits for the customer store page and owner dashboard.
app.get('/api/fruits', async (req, res) => {
  try {
    // SQL explanation: this query reads rows from the database. SELECT chooses columns, FROM chooses the table, WHERE filters rows, and ORDER BY controls sorting.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    const result = await pool.query('SELECT * FROM "Fruit" WHERE "isActive" = TRUE ORDER BY "name";');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({error: "Failed to read catalog from database"});
  }
});
//#endregion

//#region Owner order routes

// API Endpoint: Exposes total history of historical sales to the owner panel dashboard
// GET /api/orders
// Owner-only route that returns all submitted orders, grouped with their order items.
app.get('/api/orders', authenticateToken, requireRole('owner'), async (req: AuthenticatedRequest, res) => {


  try {
    // SQL explanation: this query reads rows from the database. SELECT chooses columns, FROM chooses the table, WHERE filters rows, and ORDER BY controls sorting.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    const result = await pool.query(
      `
      -- Select each order and combine its OrderItem rows into one JSON array named items.
      -- COALESCE gives fallback values so empty/missing data does not break the frontend.
      SELECT
        o."orderId",
        o."userId",
        COALESCE(u."username", 'GUEST') AS username,
        o."totalAmount",
        TO_CHAR(o."createdAt" + INTERVAL '8 hours', 'DD Mon YYYY, HH12:MI am') AS "createdAt",
        ${ORDER_ITEMS_JSON_SQL}
      FROM "Order" o
      LEFT JOIN "User" u ON o."userId" = u."id"
      LEFT JOIN "OrderItem" oi ON o."orderId" = oi."orderId"
      GROUP BY o."orderId", u."username"
      ORDER BY o."createdAt" DESC
      `
    );

    res.json(result.rows);

  } catch (error) {
    console.error('Owner orders error:', error);
    res.status(500).json({error: "Failed to read orders"})
  }
});

//#endregion

//#region Shared order creation helper
// Shared checkout helper used by both normal checkout and AI checkout.
// It keeps the important order-creation transaction in one place so the logic cannot drift between routes.
const createOrderFromItems = async ({
  items,
  userId,
  requireActiveFruit = false
}: {
  items: OrderRequestItem[];
  userId: number | null;
  requireActiveFruit?: boolean;
}): Promise<CreatedOrder> => {
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw new Error('Invalid or missing cart items');
  }

  const client = await pool.connect();

  try {
    // BEGIN starts a transaction, meaning every SQL change below must succeed together.
    // If one step fails, ROLLBACK will undo everything so stock/order data does not become half-saved.
    await client.query('BEGIN');

    const orderId = randomUUID();
    let totalAmount = 0;
    const orderItems: CreatedOrder['items'] = [];

    await client.query(
      'INSERT INTO "Order" ("orderId", "userId", "totalAmount") VALUES ($1, $2, $3)',
      [orderId, userId, 0]
    );

    for (const cartItem of items) {
      const quantity = Number(cartItem.quantity);

      if (!cartItem.id || !Number.isInteger(quantity) || quantity <= 0) {
        throw new Error('Invalid cart item quantity');
      }

      // FOR UPDATE locks the selected fruit row until the transaction finishes.
      // This prevents two checkouts from buying the same last stock at the same time.
      const fruitCheck = await client.query(
        `SELECT * FROM "Fruit"
         WHERE "id" = $1
         ${requireActiveFruit ? 'AND "isActive" = TRUE' : ''}
         FOR UPDATE`,
        [cartItem.id]
      );

      const dbFruit = fruitCheck.rows[0];

      if (!dbFruit) {
        throw new Error(`Fruit with ID ${cartItem.id} not found`);
      }

      if (Number(dbFruit.stock) < quantity) {
        throw new Error(`Not enough stock for ${dbFruit.name}`);
      }

      const price = Number(dbFruit.price);
      totalAmount += price * quantity;

      await client.query(
        'UPDATE "Fruit" SET "stock" = "stock" - $1 WHERE "id" = $2',
        [quantity, cartItem.id]
      );

      const orderItem = {
        orderItemId: randomUUID(),
        orderId,
        fruitId: dbFruit.id,
        name: dbFruit.name,
        priceAtPurchase: price,
        quantity
      };

      await client.query(
        `INSERT INTO "OrderItem"
        ("orderItemId", "orderId", "fruitId", "name", "priceAtPurchase", "quantity")
        VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          orderItem.orderItemId,
          orderItem.orderId,
          orderItem.fruitId,
          orderItem.name,
          orderItem.priceAtPurchase,
          orderItem.quantity
        ]
      );

      orderItems.push(orderItem);
    }

    await client.query(
      'UPDATE "Order" SET "totalAmount" = $1 WHERE "orderId" = $2',
      [totalAmount, orderId]
    );

    if (userId) {
      await client.query(
        'UPDATE "User" SET "cart" = $1::jsonb WHERE "id" = $2',
        [JSON.stringify([]), userId]
      );
    }

    // COMMIT confirms all database changes because every step succeeded.
    await client.query('COMMIT');

    return {
      orderId,
      totalAmount,
      items: orderItems
    };
  } catch (error) {
    // ROLLBACK cancels every change made since BEGIN if any step failed.
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
//#endregion

//#region Customer checkout and order history routes
// API Endpoint: Processes purchase request arrays, updates stock balances, and saves tickets
// POST /api/orders
// Creates an order from the cart, reduces fruit stock, saves order items, and clears the customer's saved cart if logged in.
app.post('/api/orders', optionalAuthenticateToken, async (req: AuthenticatedRequest, res) => {

  if (req.user?.role === 'owner') {
    return res.status(403).json({ error: 'Only customer can checkout' });
  }

  const items = req.body.items || req.body.cart;
  const userId = req.user?.role === 'customer' ? req.user!.userId : null;

  try {
    const order = await createOrderFromItems({
      items,
      userId,
      requireActiveFruit: false
    });

    res.status(201).json({
      message: 'Order submitted successfully',
      order
    });
  } catch (error: any) {
    console.error('Checkout error:', error);
    res.status(400).json({ error: error.message || 'Transaction failed' });
  }
});

// GET /api/my-orders
// Customer-only route that returns only the logged-in customer's own orders.
app.get('/api/my-orders', authenticateToken, requireRole('customer'), async (req: AuthenticatedRequest, res) => {

  try {
    // SQL explanation: this query reads rows from the database. SELECT chooses columns, FROM chooses the table, WHERE filters rows, and ORDER BY controls sorting.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    const result = await pool.query(
      `
      -- Select only this customer's orders and combine each order's items into an items JSON array.
      SELECT
        o."orderId",
        o."totalAmount",
        TO_CHAR(o."createdAt" + INTERVAL '8 hours', 'DD Mon YYYY, HH12:MI am') AS "createdAt",
        ${ORDER_ITEMS_JSON_SQL}
      FROM "Order" o
      LEFT JOIN "OrderItem" oi ON o."orderId" = oi."orderId"
      WHERE o."userId" = $1
      GROUP BY o."orderId"
      ORDER BY o."createdAt" DESC
      `,
      [req.user!.userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Order history error: ', error);
    res.status(500).json({ error: 'Failed to fetch order history' });
  }
})
//#endregion

//#region Owner fruit management routes

// POST /api/owner/fruits
// Owner-only route to create a new fruit or reactivate an inactive fruit with the same name.
app.post('/api/owner/fruits', authenticateToken, requireRole('owner'), async (req: AuthenticatedRequest, res) => {

  const { name, price, stock } = req.body;

  if (!name || Number(price) <= 0 || !Number.isInteger(Number(stock)) || Number(stock) < 0) {
    return res.status(400).json({ error: 'Invalid fruit name, price, or stock' });
  }

  try {
    // SQL explanation: this query reads rows from the database. SELECT chooses columns, FROM chooses the table, WHERE filters rows, and ORDER BY controls sorting.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    const existingFruit = await pool.query(
      'SELECT * FROM "Fruit" WHERE LOWER("name") = LOWER($1) LIMIT 1',
      [name.trim()]
    );

    if (existingFruit.rows.length > 0) {
      // SQL explanation: this query changes existing rows. UPDATE chooses the table, SET changes columns, WHERE chooses which row(s), and RETURNING sends changed rows back if used.
      // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
      const result = await pool.query(
        `
        UPDATE "Fruit"
        SET "name" = $1,
            "price" = $2,
            "stock" = $3,
            "isActive" = TRUE
        WHERE "id" = $4
        RETURNING *
        `,
        [
          name.trim(),
          Number(price),
          Number(stock),
          existingFruit.rows[0].id
        ]
      );

      return res.status(200).json({
        message: 'Existing fruit reactivated successfully',
        fruit: result.rows[0]
      });
    }

    // SQL explanation: this query creates new database rows. INSERT INTO chooses the table/columns, VALUES provides the data, and RETURNING asks PostgreSQL to send the saved row back.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    const result = await pool.query(
      'INSERT INTO "Fruit" ("id", "name", "price", "stock", "isActive") VALUES ($1, $2, $3, $4, TRUE) RETURNING *',
      [randomUUID(), name.trim(), Number(price), Number(stock)]
    );

    res.status(201).json({
      message: 'Fruit created successfully',
      fruit: result.rows[0]
    });
  } catch (error) {
    console.error('Create fruit error:', error);
    res.status(500).json({ error: 'Failed to create fruit' });
  }
});

// PUT /api/owner/fruits/:id
// Owner-only route to update a fruit's name, price, and stock.
app.put('/api/owner/fruits/:id', authenticateToken, requireRole('owner'), async (req: AuthenticatedRequest, res) => {
  if (req.user?.role !== 'owner') {
    return res.status(403). json({ error: 'Access denied. Owners only' });
  }

  const { id } = req.params;
  const { name, price, stock } = req.body;

  if (!name || Number(price) <= 0 || !Number.isInteger(Number(stock)) || Number(stock) < 0) {
    return res.status(400). json({ error: 'invalid fruit name, price or stock' });
  }

  try {
    // SQL explanation: this query changes existing rows. UPDATE chooses the table, SET changes columns, WHERE chooses which row(s), and RETURNING sends changed rows back if used.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    const result = await pool.query(
      `UPDATE "Fruit" 
        SET "name" = $1, 
            "price" = $2, 
            "stock" = $3 
        WHERE "id" = $4 
        RETURNING *
      `,
      [name, Number(price), Number(stock), id]
    );

    if (result.rows.length === 0) {
      return  res.status(400).json({ error: 'Fruit not found' });
    }

    res.json({
      message: 'Fruit updated successfully',
      fruit: result.rows[0]
    });
  } catch (error) {
    console.error('Fruit update error:', error);
    res.status(500).json({ error: 'Failed to update fruit' });
  }
});

// DELETE /api/owner/fruits/:id
// Owner-only route that soft-deletes a fruit by setting isActive to false. This keeps old order history safe.
app.delete('/api/owner/fruits/:id', authenticateToken, requireRole('owner'), async (req: AuthenticatedRequest, res) => {

  const { id } = req.params;

  try {
    // SQL explanation: this query changes existing rows. UPDATE chooses the table, SET changes columns, WHERE chooses which row(s), and RETURNING sends changed rows back if used.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    const result = await pool.query(
      'UPDATE "Fruit" SET "isActive" = FALSE WHERE "id" = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Fruit not found' });
    }

    res.json({
      message: 'Fruit removed successfully',
      fruit: result.rows[0]
    });
  } catch (error) {
    console.error('Delete fruit error:', error);
    res.status(500).json({ error: 'Failed to remove fruit' });
  }
});
//#endregion

//#region Owner sales dashboard routes

// GET /api/owner/daily-summary
// Owner-only dashboard route that calculates today's sales, fruit sales, 7-day trends, and out-of-stock fruits.
app.get('/api/owner/daily-summary', authenticateToken, requireRole('owner'), async (req: AuthenticatedRequest, res) => {

  try {
    // SQL explanation: this query reads rows from the database. SELECT chooses columns, FROM chooses the table, WHERE filters rows, and ORDER BY controls sorting.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    const totalResult = await pool.query(
      `
      SELECT
        COUNT(*)::int AS "totalOrders",
        COALESCE(SUM("totalAmount"), 0)::numeric(10, 2) AS "totalSales"
      FROM "Order"
      WHERE "createdAt" >= CURRENT_DATE
      AND "createdAt" < CURRENT_DATE + INTERVAL '1 day'
      `
    );

    // SQL explanation: this query reads rows from the database. SELECT chooses columns, FROM chooses the table, WHERE filters rows, and ORDER BY controls sorting.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    const fruitResult = await pool.query(
      `
      SELECT
        oi."fruitId",
        oi."name",
        SUM(oi."quantity")::int AS "quantitySold",
        COALESCE(SUM(oi."priceAtPurchase" * oi."quantity"), 0)::numeric(10, 2) AS "sales"
      FROM "OrderItem" oi
      JOIN "Order" o ON oi."orderId" = o."orderId"
      WHERE o."createdAt" >= CURRENT_DATE
      AND o."createdAt" < CURRENT_DATE + INTERVAL '1 day'
      GROUP BY oi."fruitId", oi."name"
      ORDER BY oi."name"
      `
    );

    // SQL explanation: this query reads rows from the database. SELECT chooses columns, FROM chooses the table, WHERE filters rows, and ORDER BY controls sorting.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    const activeFruitsResult = await pool.query(
      `
      SELECT "id", "name", "stock"
      FROM "Fruit"
      WHERE "isActive" = TRUE
      ORDER BY "name"
      `
    );

    // SQL explanation: this query reads rows from the database. SELECT chooses columns, FROM chooses the table, WHERE filters rows, and ORDER BY controls sorting.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    const orderedTrendResult = await pool.query(
      `
      -- WITH creates a temporary result named days.
      -- generate_series makes one row per day for the last 7 days, even if there were no orders.
      WITH days AS (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '6 days',
          CURRENT_DATE,
          INTERVAL '1 day'
        )::date AS day
      )
      SELECT
        d.day::text AS "date",
        f."id" AS "fruitId",
        f."name" AS "name",
        COALESCE(
          SUM(
            CASE
              WHEN o."orderId" IS NOT NULL THEN oi."quantity"
              ELSE 0
            END
          ),
          0
        )::int AS "quantityOrdered"
      FROM days d
      CROSS JOIN "Fruit" f
      LEFT JOIN "OrderItem" oi ON oi."fruitId" = f."id"
      LEFT JOIN "Order" o
        ON o."orderId" = oi."orderId"
        AND o."createdAt" >= d.day
        AND o."createdAt" < d.day + INTERVAL '1 day'
      WHERE f."isActive" = TRUE
      GROUP BY d.day, f."id", f."name"
      ORDER BY d.day, f."name"
      `
    );

    // SQL explanation: this query reads rows from the database. SELECT chooses columns, FROM chooses the table, WHERE filters rows, and ORDER BY controls sorting.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    const outOfStockResult = await pool.query(
      `
      SELECT "id", "name", "price", "stock"
      FROM "Fruit"
      WHERE "isActive" = TRUE
      AND "stock" <= 0
      ORDER BY "name"
      `
    );

    const trendSeries = activeFruitsResult.rows.map((fruit) => ({
      key: fruit.id,
      label: fruit.name
    }));

    const buildTrendData = (
      rows: any[],
      valueKey: 'quantityOrdered'
    ) => {
      const dataByDate = new Map<string, Record<string, string | number>>();

      for (const row of rows) {
        if (!dataByDate.has(row.date)) {
          const basePoint: Record<string, string | number> = { date: row.date };

          for (const fruit of activeFruitsResult.rows) {
            basePoint[fruit.id] = 0;
          }

          dataByDate.set(row.date, basePoint);
        }

        const point = dataByDate.get(row.date);

        if (point) {
          point[row.fruitId] = Number(row[valueKey]) || 0;
        }
      }

      return Array.from(dataByDate.values());
    };

    
    // SQL explanation: this query reads rows from the database. SELECT chooses columns, FROM chooses the table, WHERE filters rows, and ORDER BY controls sorting.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    const totalSalesTrendResult = await pool.query(`
      -- WITH creates a temporary list of dates for the chart x-axis.
      -- LEFT JOIN keeps dates with zero sales so the chart does not skip quiet days.
      WITH date_series AS (
        SELECT generate_series(
          CURRENT_DATE - INTERVAL '6 days',
          CURRENT_DATE,
          INTERVAL '1 day'
        )::date AS "date"
      )
      SELECT
        TO_CHAR(ds."date", 'MM-DD') AS "date",
        COALESCE(SUM(o."totalAmount"), 0) AS "totalSales"
      FROM date_series ds
      LEFT JOIN "Order" o
        ON DATE(o."createdAt" AT TIME ZONE 'Asia/Singapore') = ds."date"
      GROUP BY ds."date"
      ORDER BY ds."date" ASC
    `);

    const totalSalesTrend = totalSalesTrendResult.rows.map((row) => ({
      date: row.date,
      totalSales: Number(row.totalSales)
    }));

res.json({
      date: new Date().toISOString().slice(0, 10),
      totalOrders: Number(totalResult.rows[0].totalOrders),
      totalSales: Number(totalResult.rows[0].totalSales),
      fruitSalesSummary: fruitResult.rows.map((fruit) => ({
        fruitId: fruit.fruitId,
        name: fruit.name,
        quantitySold: Number(fruit.quantitySold),
        sales: Number(fruit.sales)
      })),
      totalSalesTrend,
      fruitOrdersTrend: {
        series: trendSeries,
        data: buildTrendData(orderedTrendResult.rows, 'quantityOrdered')
      },
      outOfStockFruits: outOfStockResult.rows.map((fruit) => ({
        id: fruit.id,
        name: fruit.name,
        price: Number(fruit.price),
        stock: Number(fruit.stock)
      }))
    });
  } catch (error) {
    console.error('Daily summary error', error);
    res.status(500).json({ error: 'Failed to fetch daily summary' });
  }
});
//#endregion

//#region Customer cart interest route

// API Endpoint: Shows how many fruit units are currently sitting in other customers' saved carts
// GET /api/fruits/cart-interest
// Shows how many units of each fruit are currently saved in other customers' carts.
app.get('/api/fruits/cart-interest', optionalAuthenticateToken, async (req: AuthenticatedRequest, res) => {
  const currentCustomerId = req.user?.role === 'customer' ? req.user!.userId : null;

  try {
    // SQL explanation: this query reads rows from the database. SELECT chooses columns, FROM chooses the table, WHERE filters rows, and ORDER BY controls sorting.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    const result = await pool.query(
      `
      -- jsonb_array_elements expands each saved cart array into separate rows.
      -- That lets PostgreSQL sum quantities for fruits currently sitting in customer carts.
      SELECT
        cart_item->>'id' AS "fruitId",
        SUM((cart_item->>'quantity')::int)::int AS "quantityInCarts"
      FROM "User" u
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(u."cart", '[]'::jsonb)) AS cart_item
      WHERE u."role" = 'customer'
      AND ($1::int IS NULL OR u."id" <> $1)
      GROUP BY cart_item->>'id'
      `,
      [currentCustomerId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Cart interest error:', error);
    res.status(500).json({ error: 'Failed to fetch cart interest' });
  }
});
//#endregion

//#region Customer and owner message routes

// POST /api/messages
// Customer-only route that saves a question for the store owner.
app.post('/api/messages', authenticateToken, requireRole('customer'), async (req: AuthenticatedRequest, res) => {

  const { question } = req.body;

  if (!question || !question.trim()) {
    return res.status(400).json({ error: 'Question is required' });
  }

  try {
    // SQL explanation: this query creates new database rows. INSERT INTO chooses the table/columns, VALUES provides the data, and RETURNING asks PostgreSQL to send the saved row back.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    const result = await pool.query(
      `
      INSERT INTO "Message"
        ("messageId", "customerId", "question")
      VALUES
        ($1, $2, $3)
      RETURNING *
      `,
      [
        randomUUID(),
        req.user!.userId,
        question.trim()
      ]
    );

    res.status(201).json({
      message: 'Message submitted successfully',
      customerMessage: result.rows[0]
    });
  } catch (error) {
    console.error('Create message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// GET /api/my-messages
// Customer-only route that returns the customer's own questions and replies.
app.get('/api/my-messages', authenticateToken, requireRole('customer'), async (req: AuthenticatedRequest, res) => {

  try {
    // SQL explanation: this query reads rows from the database. SELECT chooses columns, FROM chooses the table, WHERE filters rows, and ORDER BY controls sorting.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    const result = await pool.query(
      `
      SELECT
        m."messageId",
        m."question",
        m."reply",
        m."status",
        m."createdAt",
        m."repliedAt",
        owner."username" AS "repliedByOwner"
      FROM "Message" m
      LEFT JOIN "User" owner ON m."repliedByOwnerId" = owner."id"
      WHERE m."customerId" = $1
      ORDER BY m."createdAt" DESC
      `,
      [req.user!.userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('My messages error:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// GET /api/owner/messages
// Owner-only route that lists all customer questions, with pending messages shown first.
app.get('/api/owner/messages', authenticateToken, requireRole('owner'), async (req: AuthenticatedRequest, res) => {

  try {
    // SQL explanation: this query reads rows from the database. SELECT chooses columns, FROM chooses the table, WHERE filters rows, and ORDER BY controls sorting.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    const result = await pool.query(
      `
      SELECT
        m."messageId",
        customer."username" AS "customerUsername",
        m."question",
        m."reply",
        m."status",
        m."createdAt",
        m."repliedAt",
        owner."username" AS "repliedByOwner"
      FROM "Message" m
      JOIN "User" customer ON m."customerId" = customer."id"
      LEFT JOIN "User" owner ON m."repliedByOwnerId" = owner."id"
      ORDER BY
        CASE WHEN m."status" = 'pending' THEN 0 ELSE 1 END,
        m."createdAt" DESC
      `
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Owner messages error:', error);
    res.status(500).json({ error: 'Failed to fetch owner messages' });
  }
});

// PUT /api/owner/messages/:id/reply
// Owner-only route that replies to one pending customer question and marks it as answered.
app.put('/api/owner/messages/:id/reply', authenticateToken, requireRole('owner'), async (req: AuthenticatedRequest, res) => {

  const { id } = req.params;
  const { reply } = req.body;

  if (!reply || !reply.trim()) {
    return res.status(400).json({ error: 'Reply cannot be empty' });
  }

  try {
    // SQL explanation: this query changes existing rows. UPDATE chooses the table, SET changes columns, WHERE chooses which row(s), and RETURNING sends changed rows back if used.
    // The $1, $2, etc. placeholders are safely filled by the values array after the SQL string, which helps prevent SQL injection.
    const result = await pool.query(
      `
      UPDATE "Message"
      SET
        "reply" = $1,
        "repliedByOwnerId" = $2,
        "status" = 'answered',
        "repliedAt" = CURRENT_TIMESTAMP
      WHERE "messageId" = $3
      AND "status" = 'pending'
      RETURNING *
      `,
      [
        reply.trim(),
        req.user!.userId,
        id
      ]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({
        error: 'This message may have already been answered by another owner'
      });
    }

    res.json({
      message: 'Reply submitted successfully',
      customerMessage: result.rows[0]
    });
  } catch (error) {
    console.error('Reply message error:', error);
    res.status(500).json({ error: 'Failed to reply message' });
  }
});
//#endregion

//#region AI shopping agent types and helper functions

// =====================================================
// SHOPPING AGENT ROUTE
// Frontend FloatingCustomerChat posts to POST /api/agent
// Requires GEMINI_API_KEY in your backend environment variables.
// =====================================================

// The only actions the AI shopping agent is allowed to return.
// Restricting actions makes the backend safer because random AI text cannot directly run code.
type AgentAction = {
  action: 'answer' | 'add_to_cart' | 'remove_from_cart' | 'remove_all_from_cart' | 'checkout';
  reply: string;
  items?: Array<{
    id?: string;
    fruitName?: string;
    quantity: number;
  }>;
};

// Pulls a JSON object out of the AI model's text response and parses it into JavaScript.
const extractJsonObject = (text: string) => {
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error('Agent returned an invalid response');
  }

  return JSON.parse(text.slice(firstBrace, lastBrace + 1));
};

// Converts AI-requested fruit names/ids into real active fruits from the database and returns the next cart state.
// This function is used when the AI says the customer wants to add fruits to the cart.
// Important: we do not blindly trust the AI. We re-check everything against the real database catalogue.
const resolveAgentItemsToCart = async (
  currentCart: OrderRequestItem[],
  requestedItems: Array<{ id?: string; fruitName?: string; quantity: number }>
) => {
  // Get the latest list of active fruits from the database.
  // This makes sure the AI can only add fruits that really exist and are currently active.
  const activeFruits = await getActiveFruits();

  // Create a copy of the current cart.
  // We do this so we can safely modify nextCart without directly mutating the original currentCart array.
  const nextCart = [...currentCart];

  // Stores friendly warning messages for the customer.
  // Example: "Apple was capped at 3 due to available stock."
  const notes: string[] = [];

  // Loop through every fruit item the AI asked to add.
  // Example: if the AI returns apples and oranges, this loop handles them one by one.
  for (const requestedItem of requestedItems || []) {
    // The AI may provide either a fruit id or a fruit name.
    // We clean both values before comparing them with the database.
    const requestedId = requestedItem.id ? String(requestedItem.id).trim() : '';
    const fruitName = String(requestedItem.fruitName || '').trim().toLowerCase();

    // Convert the AI's quantity into a number.
    // This protects us from weird values like "two", null, undefined, or negative numbers.
    const quantityToAdd = Number(requestedItem.quantity);

    // Skip invalid quantities.
    // The AI is not allowed to add 0, negative numbers, decimals, or non-number values.
    if (!Number.isInteger(quantityToAdd) || quantityToAdd <= 0) {
      continue;
    }

    // Try to find the fruit in the real database catalogue.
    // Prefer matching by id if the AI gave an id, because ids are more accurate than names.
    // If no id was given, match by exact fruit name.
    const matchingFruit = requestedId
      ? activeFruits.find((fruit) => String(fruit.id) === requestedId)
      : activeFruits.find(
          (fruit) => String(fruit.name).toLowerCase() === fruitName
        );

    // If the AI mentioned a fruit that does not exist in the active catalogue,
    // do not add it. Instead, save a note for the customer.
    if (!matchingFruit) {
      notes.push(
        requestedItem.fruitName
          ? `${requestedItem.fruitName} is not in the current catalogue.`
          : 'That item is not in the current catalogue.'
      );
      continue;
    }

    // Check if this fruit is already inside the customer's cart.
    // findIndex returns the array position if found, or -1 if not found.
    const existingIndex = nextCart.findIndex(
      (item) => String(item.id) === String(matchingFruit.id)
    );

    // If the fruit already exists in the cart, get its current quantity.
    // If it does not exist, start from 0.
    const existingCartItem = existingIndex >= 0 ? nextCart[existingIndex] : undefined;
    const existingQuantity = existingCartItem ? Number(existingCartItem.quantity) : 0;

    // Add the AI-requested quantity to the existing cart quantity.
    // Then cap the final quantity at available stock so customers cannot add more than what the store has.
    const finalQuantity = Math.min(
      existingQuantity + quantityToAdd,
      Number(matchingFruit.stock)
    );

    // If finalQuantity is 0, it means the fruit is out of stock.
    // Do not add it to the cart.
    if (finalQuantity <= 0) {
      notes.push(`${matchingFruit.name} is currently out of stock.`);
      continue;
    }

    // If the requested quantity is more than available stock,
    // tell the customer that the quantity was reduced to the maximum available stock.
    if (finalQuantity < existingQuantity + quantityToAdd) {
      notes.push(`${matchingFruit.name} was capped at ${finalQuantity} due to available stock.`);
    }

    // Build the cart item object that the frontend expects.
    // We store id, name, price, and quantity so the cart can display the item properly.
    const cartItem = {
      id: String(matchingFruit.id),
      name: String(matchingFruit.name),
      price: Number(matchingFruit.price),
      quantity: finalQuantity
    };

    // If the fruit already exists in the cart, replace its old quantity with the new quantity.
    // If it does not exist, add it as a new cart item.
    if (existingIndex >= 0) {
      nextCart[existingIndex] = cartItem;
    } else {
      nextCart.push(cartItem);
    }
  }

  // Return both:
  // nextCart = the updated cart
  // notes = extra messages explaining any stock limits or unavailable fruits
  return { nextCart, notes };
};
//#endregion

//#region AI shopping agent route

// POST /api/agent
// Customer-only AI shopping route.
// This route lets the customer chat with an AI assistant.
// The AI can answer questions, add fruits to cart, remove fruits, clear cart, or checkout.
// Even though the AI suggests actions, the backend still validates everything before changing the database.
app.post('/api/agent', authenticateToken, requireRole('customer'), async (req: AuthenticatedRequest, res) => {
  // Read the Gemini API key from environment variables.
  // This key should never be hardcoded in the source code because it is secret.
  const geminiApiKey = process.env.GEMINI_API_KEY;

  // If the key is missing, the AI feature cannot work.
  if (!geminiApiKey) {
    return res.status(500).json({ error: 'GEMINI_API_KEY is missing from environment variables' });
  }

  // message = latest customer message
  // cart = current cart from the frontend
  // conversationHistory = recent chat messages, used so the AI understands follow-up questions
  const { message, cart, conversationHistory } = req.body;

  // Make sure the customer actually typed something.
  if (!message || !String(message).trim()) {
    return res.status(400).json({ error: 'Please type a message for the agent' });
  }

  // Clean and validate the cart sent from the frontend.
  // This prevents bad cart data from being trusted directly.
  // Only keep items with:
  // - an id
  // - a whole-number quantity
  // - quantity greater than 0
  const safeCart: OrderRequestItem[] = Array.isArray(cart)
    ? cart
        .filter((item) => item?.id && Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0)
        .map((item) => ({ id: String(item.id), quantity: Number(item.quantity) }))
    : [];

  // Keep only a small amount of recent conversation history.
  // This prevents sending too much data to Gemini and keeps the prompt smaller/faster.
  const shortConversationHistory = Array.isArray(conversationHistory)
    ? conversationHistory
        .slice(-8)
        .filter((entry: any) => entry && typeof entry.text === 'string')
        .map((entry: any) => ({
          // Only allow "user" or "assistant" as roles.
          role: entry.role === 'user' ? 'user' : 'assistant',

          // Limit each message to 500 characters so the AI prompt does not become too long.
          text: String(entry.text).slice(0, 500)
        }))
    : [];

  try {
    // Get the latest active fruit catalogue from the database.
    // This is the source of truth, not the AI.
    const activeFruits = await getActiveFruits();

    // Convert database fruits into a simple format for the AI prompt.
    // The AI receives only the fruit information it needs: id, name, price, stock.
    const catalogueForPrompt = activeFruits.map((fruit) => ({
      id: String(fruit.id),
      name: fruit.name,
      price: Number(fruit.price),
      stock: Number(fruit.stock)
    }));

    // Convert the cart into a human-readable format for the AI.
    // Instead of only seeing fruit ids, the AI can see names, quantities, and prices.
    const cartForPrompt = safeCart.map((cartItem) => {
      const matchingFruit = activeFruits.find((fruit) => String(fruit.id) === String(cartItem.id));

      return {
        name: matchingFruit?.name || cartItem.id,
        quantity: cartItem.quantity,
        price: matchingFruit ? Number(matchingFruit.price) : undefined
      };
    });

    const agentInstruction = `You are a helpful shopping assistant for a small fruit store.
    You can answer questions about the catalogue, prices, stock, and current basket.
    Use the recent conversation to understand short follow-ups.
    You can request basket changes or checkout only when the user clearly asks for it.
    Never invent products. Only use exact fruit names from the catalogue.
    If the user asks to add an item, return action "add_to_cart" and list items.
    If the user asks to remove an item, return action "remove_from_cart" and list items. If no quantity is stated, remove all of that item.
    If the user asks to clear the basket/cart or remove everything, return action "remove_all_from_cart".
    If the user asks to checkout/pay/purchase the current basket, return action "checkout".
    If the user asks to add items and checkout in the same message, return action "checkout" and list those items.
    If the user asks a general fruit question, answer briefly and practically.
    Return JSON only in this exact shape:
    {
      "action": "answer" | "add_to_cart" | "remove_from_cart" | "remove_all_from_cart" | "checkout",
      "reply": "short customer-friendly reply",
      "items": [{ "id": "exact catalogue fruit id", "fruitName": "exact catalogue fruit name", "quantity": 1 }]
    }
    For remove_from_cart only: if the user does not state a quantity, set quantity to 0. Quantity 0 means remove all of that fruit from the basket.`;

    // Send the prompt to Gemini.
    // The prompt includes:
    // 1. Rules/instructions for the AI
    // 2. Current fruit catalogue
    // 3. Current basket
    // 4. Recent conversation
    // 5. Customer's latest message
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: `${agentInstruction}\n\nCatalogue:\n${JSON.stringify(catalogueForPrompt)}\n\nCurrent basket:\n${JSON.stringify(cartForPrompt)}\n\nRecent conversation:\n${JSON.stringify(shortConversationHistory)}\n\nCustomer message:\n${String(message).trim()}`
                }
              ]
            }
          ],
          generationConfig: {
            // Lower temperature makes the AI more predictable and less random.
            // This is useful because we need structured JSON, not creative writing.
            temperature: 0.2
          }
        })
      }
    );

    // Try to parse Gemini's response as JSON.
    // If Gemini returns invalid JSON, geminiData becomes null instead of crashing immediately.
    const geminiData: any = await geminiResponse.json().catch(() => null);

    // If Gemini itself failed, return 502 because the backend depended on an external AI service.
    if (!geminiResponse.ok) {
      console.error('Gemini API error:', geminiData);
      return res.status(502).json({ error: 'The shopping agent could not respond right now' });
    }

    // Gemini returns text, but we instructed it to put JSON inside the text.
    // rawText is the AI's actual message output.
    const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    // Extract the JSON object from Gemini's text and convert it into an AgentAction.
    // This tells the backend what the AI thinks should happen next.
    const agentAction = extractJsonObject(rawText || '') as AgentAction;

    // Safety check: only allow known actions.
    // If the AI returns anything unexpected, reject it.
    if (!['answer', 'add_to_cart', 'remove_from_cart', 'remove_all_from_cart', 'checkout'].includes(agentAction.action)) {
      throw new Error('Agent selected an unsupported action');
    }

  // Convert the AI's requested items into a validated cart.
  // Example: if the AI says "add 2 apples", this function checks if Apple exists,
  // checks stock, caps quantity if needed, and returns the updated cart.
  // notes stores extra customer-friendly messages, such as stock warnings.
  const { nextCart, notes } = await resolveAgentItemsToCart(safeCart, agentAction.items || []);

  // If the AI is only answering a general/store question, return the answer immediately.
  // Without this block, action "answer" would fall through to the checkout code below,
  // which caused normal questions like "Tell me about yourself" to show
  // "Your basket is empty, so there is nothing to checkout".
  if (agentAction.action === 'answer') {
    return res.json({
      action: 'answer',
      reply: agentAction.reply || 'I can help with fruit questions, your basket, and checkout.',
      cart: safeCart
    });
  }

  // If the AI decided the customer wants to add fruits to the cart,
  // save the updated cart into the logged-in user's database profile.
  if (agentAction.action === 'add_to_cart') {
    // SQL explanation: this query updates the customer's saved cart in the User table.
    // SET "cart" = $1::jsonb stores the updated cart as JSONB data.
    // WHERE "id" = $2 makes sure only the current logged-in customer's row is updated.
    // The placeholders $1 and $2 prevent SQL injection because the actual values are passed separately.
    await pool.query(
      'UPDATE "User" SET "cart" = $1::jsonb WHERE "id" = $2',
      [JSON.stringify(nextCart), req.user!.userId]
    );

    // Send the new cart back to the frontend so the UI can update immediately.
    // The reply combines the AI's message with any backend notes, such as stock-limit warnings.
    return res.json({
      action: 'add_to_cart',
      reply: [agentAction.reply || 'I updated your basket.', ...notes].join(' '),
      cart: nextCart
    });
  }

  // If the AI decided the customer wants to remove fruits from the cart,
  // we calculate the updated cart manually.
  if (agentAction.action === 'remove_from_cart') {
    // Convert the safeCart into the fuller cart format expected by the frontend.
    // safeCart only has id and quantity, so we use activeFruits to add back name and price.
    const updatedCart = safeCart.map((cartItem) => {
      const matchingFruit = activeFruits.find(
        (fruit) => String(fruit.id) === String(cartItem.id)
      );

      return {
        id: String(cartItem.id),
        name: matchingFruit?.name || '',
        price: matchingFruit ? Number(matchingFruit.price) : 0,
        quantity: Number(cartItem.quantity)
      };
    });

    // Loop through every item the AI wants to remove.
    // Example: "remove 2 apples and all bananas" can produce multiple items.
    for (const item of agentAction.items || []) {
      // The AI may provide either a fruit id or fruit name.
      // We clean both before searching.
      const requestedId = item.id ? String(item.id).trim() : '';
      const fruitName = String(item.fruitName || '').toLowerCase().trim();

      // Try to find the fruit in the active fruit catalogue.
      // We first try exact id because id is most accurate.
      // Then we try exact name.
      // Then we allow partial name matching to handle casual AI output like "apple" vs "red apple".
      const matchingFruit =
        activeFruits.find((fruit) => requestedId && String(fruit.id) === requestedId) ||
        activeFruits.find((fruit) => String(fruit.name).toLowerCase().trim() === fruitName) ||
        activeFruits.find((fruit) => fruitName && String(fruit.name).toLowerCase().includes(fruitName)) ||
        activeFruits.find((fruit) => fruitName && fruitName.includes(String(fruit.name).toLowerCase()));

      // If the fruit cannot be found, do not change the cart.
      // Add a note so the customer understands what happened.
      if (!matchingFruit) {
        notes.push(
          item.fruitName
            ? `I could not find ${item.fruitName} in your basket.`
            : 'I could not find that fruit in your basket.'
        );
        continue;
      }

      // Find the fruit inside the customer's current cart.
      // If it is not in the cart, there is nothing to remove.
      const existingIndex = updatedCart.findIndex(
        (cartItem) => String(cartItem.id) === String(matchingFruit.id)
      );

      const existingCartItem = existingIndex >= 0 ? updatedCart[existingIndex] : undefined;

      // If the fruit exists in the catalogue but is not currently in the cart,
      // tell the customer instead of failing silently.
      if (!existingCartItem) {
        notes.push(`${matchingFruit.name} is not currently in your basket.`);
        continue;
      }

      // Convert the AI's requested remove quantity into a number.
      // For remove_from_cart, quantity 0 means "remove all".
      // This is based on the instruction we gave to Gemini earlier.
      const requestedQuantity = Number(item.quantity);

      // removeAll becomes true if:
      // - the AI did not provide a valid whole number
      // - the AI gave 0 or less
      // In both cases, we treat it as removing all of that fruit.
      const removeAll = !Number.isInteger(requestedQuantity) || requestedQuantity <= 0;

      // Decide how many units to remove.
      // If removeAll is true, remove the full existing quantity.
      // Otherwise, remove only the requested amount, but never more than what is currently in the cart.
      const quantityToRemove = removeAll
        ? Number(existingCartItem.quantity)
        : Math.min(requestedQuantity, Number(existingCartItem.quantity));

      // Calculate how many units remain after removing.
      const remainingQuantity = Number(existingCartItem.quantity) - quantityToRemove;

      // If some quantity remains, update the cart item with the new smaller quantity.
      // If nothing remains, remove the item completely from the cart array.
      if (remainingQuantity > 0) {
        updatedCart[existingIndex] = {
          id: String(matchingFruit.id),
          name: matchingFruit.name,
          price: Number(matchingFruit.price),
          quantity: remainingQuantity
        };
      } else {
        updatedCart.splice(existingIndex, 1);
      }
    }

    // Save the updated cart after removing items.
    // This keeps the database cart and frontend cart in sync.
    await pool.query(
      'UPDATE "User" SET "cart" = $1::jsonb WHERE "id" = $2',
      [JSON.stringify(updatedCart), req.user!.userId]
    );

    // Return the updated cart to the frontend.
    return res.json({
      action: 'remove_from_cart',
      reply: [agentAction.reply || 'I updated your basket.', ...notes].join(' '),
      cart: updatedCart
    });
  }

  // If the AI decided the customer wants to clear the entire cart,
  // replace the saved cart with an empty array.
  if (agentAction.action === 'remove_all_from_cart') {
    // SQL explanation: this query clears the customer's saved cart.
    // JSON.stringify([]) stores an empty JSON array in the cart column.
    await pool.query(
      'UPDATE "User" SET "cart" = $1::jsonb WHERE "id" = $2',
      [JSON.stringify([]), req.user!.userId]
    );

    // Return an empty cart so the frontend clears the basket immediately.
    return res.json({
      action: 'remove_all_from_cart',
      reply: agentAction.reply || 'I cleared your basket.',
      cart: []
    });
  }

  // If the AI action reaches this point, the only remaining supported action is checkout.
  // checkout can happen in two ways:
  // 1. User says "checkout my current basket" -> use safeCart.
  // 2. User says "add 2 apples and checkout" -> use nextCart, which includes the newly added items.
  const checkoutCart = nextCart.length > 0 ? nextCart : safeCart;

  // Do not allow checkout if the cart is empty.
  if (checkoutCart.length === 0) {
    return res.status(400).json({ error: 'Your basket is empty, so there is nothing to checkout' });
  }

  // Create the order using the shared checkout helper.
  // This helper handles the important database steps:
  // - create the order
  // - check fruit stock
  // - reduce stock
  // - save order items
  // - clear the customer's saved cart
  const order = await createOrderFromItems({
    items: checkoutCart,
    userId: req.user?.userId || null,

    // requireActiveFruit true means the AI can only checkout fruits that are still active in the catalogue.
    requireActiveFruit: true
  });


    return res.status(201).json({
      action: 'checkout',
      reply: [agentAction.reply || 'Checkout successful!', ...notes].join(' '),

      // Cart is now empty because the order has been successfully submitted.
      cart: [],
      order
    });
  } catch (error: any) {
    console.error('Agent error:', error);
    res.status(400).json({ error: error.message || 'Agent request failed' });
  }
});
//#endregion

//#region Server startup and export

// Uses the hosting platform's PORT if available; otherwise uses 3000 during local development.
const PORT = process.env.PORT || 3000;

// In local development, start the server manually. In production on Vercel, Vercel imports/export the app instead.
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`API server running on http://localhost:${PORT}`);
  });
}

export default app;
//#endregion