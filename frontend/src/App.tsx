//#region File overview and imports

// This is the main React frontend file for the fruit store app.
// It contains the screens/components for customers, owners, login/register, cart, orders, charts, and chat.
// React code is made from smaller reusable functions called components. Each component returns JSX, which is the HTML-like UI shown in the browser.
import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import './App.css'

//#endregion

//#region TypeScript interfaces and types

// Interfaces describe the "shape" of data. They do not run in the browser; they help TypeScript catch mistakes while coding.
// Example: a Fruit must always have id, name, price, and stock. If one is missing, TypeScript can warn us before deployment.

// Represents one fruit row from the database/catalogue that can be displayed for sale.
interface Fruit {
  id: string;
  name: string;
  price: number;
  stock: number;
}

// Structure for items added to the customer's shopping cart
// Represents one fruit currently inside the customer cart. It is similar to Fruit, but also stores the chosen quantity.
interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

// Structure for historical order tickets processed by the backend
// Represents one fruit line inside a submitted order, for example: 3 apples in order ABC.
interface OrderItem {
  orderItemId?: string; //Optional so that when reordering a new orderItemId is generated
  fruitId: string;
  name: string;
  priceAtPurchase: number;
  quantity: number;
}

// Represents a full order shown to a customer in their own order history.
interface CustomerOrder {
  orderId: string;
  totalAmount: number;
  createdAt: string;
  items: OrderItem[];
}

// Represents a full order shown to the owner. It extends CustomerOrder by adding customer identity details.
interface OwnerOrder extends CustomerOrder {
  userId: number;
  username: string;
}

// Represents an active fruit that currently has 0 or less stock, so the owner can restock it.
interface OutOfStockFruit {
  id: string;
  name: string;
  price: number;
  stock: number;
}


//#region Owner sales summary and trend types
// Represents today's sales for one fruit, used in the owner's sales dashboard.
interface DailyFruitSalesSummary {
  fruitId: string;
  name: string;
  quantitySold: number;
  sales: number;
}

// Represents one line/series in a chart, such as Apple or Banana.
interface TrendSeries {
  key: string;
  label: string;
}

// Represents the full chart data: the series names plus the rows of values to plot.
interface TrendChartData {
  series: TrendSeries[];
  data: Array<any>;
}

// Represents one point in the owner's total sales chart, usually one date and one sales amount.
interface TotalSalesTrendPoint {
  date: string;
  totalSales: number;
}


// Represents the whole owner dashboard summary returned by the backend daily-summary API.
interface DailySalesSummary {
  date: string;
  totalOrders: number;
  totalSales: number;
  fruitSalesSummary: DailyFruitSalesSummary[];
  totalSalesTrend: TotalSalesTrendPoint[];
  fruitOrdersTrend?: TrendChartData;
  outOfStockFruits?: OutOfStockFruit[];
}

// Represents how many units of a fruit are sitting in other customers' saved carts.
interface CartInterest {
  fruitId: string;
  quantityInCarts: number;
}
//#endregion

//#region Customer messaging and chat types
// Represents one customer question and the owner's reply status.
interface CustomerMessage {
  messageId: string;
  question: string;
  reply: string | null;
  status: 'pending' | 'answered';
  createdAt: string;
  repliedAt: string | null;
  repliedByOwner?: string | null;
}

// Represents a customer message as seen by the owner, including the customer's username.
interface OwnerMessage extends CustomerMessage {
  customerUsername: string;
}

// Props required by the floating chat widget so it can read/update the cart and refresh after bot checkout.
interface FloatingCustomerChatProps {
  cart: CartItem[];
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  onAfterAgentCheckout: () => Promise<void>;
}

// Represents one chat bubble in the floating customer chat.
interface ChatLine {
  role: 'user' | 'bot' | 'system';
  text: string;
}

// Restricts the chat mode to only two allowed values, preventing typo bugs like 'bots' or 'admin'.
type ChatMode = 'bot' | 'owner';
//#endregion

// Props are inputs passed into a React component. OwnerOrderCard needs one owner order to display.
interface OwnerOrderCardProps {
  order: OwnerOrder;
}

// Prop types required by the FruitCatalougeCard component
// Props required by FruitCatalogueCard so it can show one fruit and update the cart when buttons are clicked.
interface FruitCatalogueCardProps {
  fruit: Fruit;
  cart: CartItem[];
  cartInterestCount: number;
  updateCartItemQuantity: (fruitId: string, quantity: number) => void;
}

// Prop types required by the CheckoutCard component
// Props required by CartSummary so it can display cart items, totals, and checkout actions.
interface CartSummaryProps {
  cart: CartItem[];
  fruitCatalogue: Fruit[];
  updateCartItemQuantity: (fruitId: string, quantity: number) => void;
  removeAllFromCart: () => void;
  checkoutCart: () => void;
}

// Props required by CartItemRow so one cart row knows its quantity limits and update function.
interface CartItemRowProps {
  cartItem: CartItem;
  maxStock: number;
  updateCartItemQuantity: (fruitId: string, quantity: number) => void;
}

// Props required by LoginPage so it can notify App after successful login or logout.
interface LoginPageProps {
  onLoginSuccess: (token: string, role: string, username: string, cart: CartItem[]) => void;
  loggedInUsername: string | null;
  onLogout: () => void;
}

//#endregion

//#region Constants and helper functions

// Reads the backend API base URL from Vite environment variables, so local/dev/prod can use different API URLs.
const API_URL = import.meta.env.VITE_API_URL;

if (!API_URL) {
  console.error('VITE_API_URL is missing. Check frontend/.env');
}


// Stores adjustable frontend settings in one place so common values can be changed without searching through the full file.
// These are not secrets. They are UI/application behaviour settings such as page size, low-stock warning level, and chat refresh timing.
const APP_CONFIG = {
  // Fruit cards show the "low stock" style when stock is less than or equal to this number.
  lowStockThreshold: 5,

  pagination: {
    // Number of previous orders shown per page in the customer's order history.
    customerOrderHistoryItemsPerPage: 6,

    // Number of fruits shown per page in the customer's fruit catalogue.
    customerFruitCatalogueItemsPerPage: 6,

    // Number of fruits shown per page in the owner's manage catalogue section.
    ownerManageCatalogueItemsPerPage: 6,

    // Number of submitted orders shown per page in the owner's submitted orders section.
    ownerSubmittedOrdersItemsPerPage: 6
  },

  orderDisplay: {
    // Full order IDs are long UUIDs. This controls how many characters are displayed in the UI.
    shortenedOrderIdLength: 8
  },

  charts: {
    // Text shown above charts. The backend currently returns 7-day trend data.
    trendRangeLabel: 'Last 7 days',

    ownerLineChart: {
      width: 720,
      height: 300,
      paddingLeft: 56,
      paddingRight: 28,
      paddingTop: 34,
      paddingBottom: 48,
      lineWidth: 3,
      pointRadius: 4,
      xAxisLabelOffset: 12,
      yAxisLabelOffsetX: 10,
      yAxisLabelOffsetY: 4
    },

    simpleLineChart: {
      width: 720,
      height: 280,
      paddingLeft: 58,
      paddingRight: 28,
      paddingTop: 30,
      paddingBottom: 46,
      lineWidth: 4,
      pointRadius: 5,
      xAxisLabelOffset: 12,
      yAxisLabelOffsetX: 10,
      yAxisLabelOffsetY: 4
    }
  },

  chat: {
    // Delay before auto-scrolling chat to the latest message after the UI updates.
    autoScrollDelayMs: 50,

    // Number of recent chat messages sent to the backend AI agent as context.
    conversationHistoryLimit: 8,

    // Example quantity shown in the chat placeholder text.
    placeholderExampleQuantity: 2
  },

  cartInterest: {
    // How often the customer page refreshes "in other carts" counts.
    refreshIntervalMs: 5000
  },

  ownerMessages: {
    // Starting height for the owner's reply textarea.
    replyTextareaRows: 3
  }
} as const;

// Converts dates from the backend into a Singapore-friendly display format.
// This prevents the UI from showing confusing UTC times.
const formatSgDateTime = (dateValue: string) => {
  const hasTimezone =
    dateValue.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dateValue);

  const normalizedDateValue = hasTimezone
    ? dateValue
    : dateValue.replace(' ', 'T') + 'Z';

  const date = new Date(normalizedDateValue);

  if (Number.isNaN(date.getTime())) {
    return dateValue;
  }

  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(date);
};

// Shows only the first 8 characters of a long UUID order id, making order cards easier to read.
const shortenOrderId = (orderId: string) => {
  return orderId.slice(0, APP_CONFIG.orderDisplay.shortenedOrderIdLength).toUpperCase();
};


// Builds request headers for API calls.
// If a token is provided, it adds Authorization so the backend knows who is logged in.
// If includeJson is true, it also tells the backend that the request body is JSON.
const getAuthHeaders = (token: string | null, includeJson = false): HeadersInit => ({
  ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
  ...(token ? { Authorization: `Bearer ${token}` } : {})
});

// Reusable fetch helper for API routes that return JSON.
// This prevents every component from repeating response.json(), response.ok checks, and error handling.
async function apiRequest<T>(url: string, options?: RequestInit, fallbackError = 'Request failed'): Promise<T> {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.error || fallbackError);
  }

  return data as T;
}

// Reusable pagination calculation.
// It returns a safe current page and the exact slice of items that should appear on that page.

// Compares a saved cart against the latest fruit catalogue.
// This fixes stale saved carts after another customer buys stock, or after the owner edits name/price/availability.
function reconcileCartWithCatalogue(cart: CartItem[], fruitCatalogue: Fruit[]) {
  const messages: string[] = [];
  let changed = false;

  const nextCart = cart
    .map((cartItem) => {
      const matchingFruit = fruitCatalogue.find((fruit) => String(fruit.id) === String(cartItem.id));

      if (!matchingFruit || Number(matchingFruit.stock) <= 0) {
        messages.push(`- ${cartItem.name} is no longer available and was removed from your cart.`);
        changed = true;
        return null;
      }

      const oldQuantity = Number(cartItem.quantity) || 0;
      const currentStock = Number(matchingFruit.stock) || 0;
      const finalQuantity = Math.min(oldQuantity, currentStock);
      const currentPrice = Number(matchingFruit.price);
      const oldPrice = Number(cartItem.price);

      if (cartItem.name !== matchingFruit.name) {
        messages.push(`- ${cartItem.name} was renamed to ${matchingFruit.name}.`);
        changed = true;
      }

      if (oldPrice !== currentPrice) {
        messages.push(`- ${matchingFruit.name} price changed from $${oldPrice.toFixed(2)} to $${currentPrice.toFixed(2)}.`);
        changed = true;
      }

      if (finalQuantity < oldQuantity) {
        messages.push(`- ${matchingFruit.name} only has ${currentStock} in stock, so quantity changed from ${oldQuantity} to ${finalQuantity}.`);
        changed = true;
      }

      const updatedCartItem = {
        id: String(matchingFruit.id),
        name: String(matchingFruit.name),
        price: currentPrice,
        quantity: finalQuantity
      };

      if (
        String(cartItem.id) !== updatedCartItem.id ||
        cartItem.name !== updatedCartItem.name ||
        oldPrice !== updatedCartItem.price ||
        oldQuantity !== updatedCartItem.quantity
      ) {
        changed = true;
      }

      return updatedCartItem;
    })
    .filter((item): item is CartItem => item !== null && item.quantity > 0);

  return {
    nextCart,
    messages,
    changed
  };
}

function getPaginatedItems<T>(items: T[], currentPage: number, itemsPerPage: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
  const safePage = Math.min(Math.max(currentPage, 1), totalPages);
  const paginatedItems = items.slice(
    (safePage - 1) * itemsPerPage,
    safePage * itemsPerPage
  );

  return {
    totalPages,
    safePage,
    paginatedItems
  };
}

//#endregion

//#region Shared UI components

// Reusable pagination component. It shows Previous/Next buttons when a list has more items than one page can display.
function PaginationControls({
  currentPage,
  totalItems,
  itemsPerPage,
  onPageChange
}: {
  currentPage: number;
  totalItems: number;
  itemsPerPage: number;
  onPageChange: (page: number) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
  const safeCurrentPage = Math.min(Math.max(currentPage, 1), totalPages);
  const startItem = totalItems === 0 ? 0 : (safeCurrentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(safeCurrentPage * itemsPerPage, totalItems);

  if (totalItems <= itemsPerPage) {
    return null;
  }

  return (
    <div className="pagination-bar">
      <p>
        Showing {startItem}-{endItem} of {totalItems}
      </p>

      <div className="pagination-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={safeCurrentPage <= 1}
          onClick={() => onPageChange(safeCurrentPage - 1)}
        >
          Previous
        </button>

        <span>
          Page {safeCurrentPage} of {totalPages}
        </span>

        <button
          type="button"
          className="secondary-button"
          disabled={safeCurrentPage >= totalPages}
          onClick={() => onPageChange(safeCurrentPage + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
//#endregion

//#region Shared quantity input logic

// This reusable hook contains the repeated quantity input behaviour used by both FruitCatalogueCard and CartItemRow.
// A custom hook is a normal function that can use React hooks such as useState and useEffect.
// This keeps quantity input rules in one place instead of duplicating the same handlers in multiple components.
function useQuantityInput({
  itemId,
  currentQuantity,
  maxQuantity,
  updateCartItemQuantity
}: {
  itemId: string;
  currentQuantity: number;
  maxQuantity: number;
  updateCartItemQuantity: (fruitId: string, quantity: number) => void;
}) {
  const [quantityInput, setQuantityInput] = useState(String(currentQuantity));

  // Keeps the input text in sync when the actual cart quantity changes from another button/action.
  useEffect(() => {
    setQuantityInput(String(currentQuantity));
  }, [currentQuantity]);

  // Runs every time the quantity input changes.
  // It removes non-numbers, prevents negative quantities, and caps the value at available stock.
  const handleQuantityChange = (value: string) => {
    const onlyNumbers = value.replace(/\D/g, '');

    if (onlyNumbers === '') {
      setQuantityInput('');
      return;
    }

    const nextQuantity = Number(onlyNumbers);

    if (nextQuantity <= 0) {
      setQuantityInput('0');
      updateCartItemQuantity(itemId, 0);
      return;
    }

    const cappedQuantity = Math.min(nextQuantity, maxQuantity);

    setQuantityInput(String(cappedQuantity));
    updateCartItemQuantity(itemId, cappedQuantity);
  };

  // Runs when the user clicks away from the quantity input.
  // It fixes empty/invalid values so the cart stays valid.
  const handleQuantityBlur = () => {
    if (quantityInput === '') {
      setQuantityInput(String(currentQuantity));
      return;
    }

    if (Number(quantityInput) <= 0) {
      updateCartItemQuantity(itemId, 0);
      return;
    }

    updateCartItemQuantity(
      itemId,
      Math.min(Number(quantityInput), maxQuantity)
    );
  };

  // Runs when a key is pressed inside the quantity input.
  // Pressing Enter confirms the value and leaves the input.
  const handleQuantityKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') {
      return;
    }

    e.preventDefault();
    e.currentTarget.blur();

    if (quantityInput === '' || Number(quantityInput) <= 0) {
      updateCartItemQuantity(itemId, 0);
      return;
    }

    updateCartItemQuantity(
      itemId,
      Math.min(Number(quantityInput), maxQuantity)
    );
  };

  return {
    quantityInput,
    handleQuantityChange,
    handleQuantityBlur,
    handleQuantityKeyDown
  };
}

//#endregion

//#region Chart components

// Draws a multi-line SVG chart for the owner dashboard. Each fruit can become one line on the chart.
function OwnerLineChart({
  label,
  subtitle,
  chart,
  valueLabel
}: {
  label: string;
  subtitle: string;
  chart?: TrendChartData;
  valueLabel: string;
}) {
  const data = chart?.data || [];
  const series = chart?.series || [];

  if (data.length === 0 || series.length === 0) {
    return (
      <div className="trend-chart-card">
        <div className="trend-chart-header">
          <div>
            <h3>{label}</h3>
            <p>{subtitle}</p>
          </div>
          <span>{APP_CONFIG.charts.trendRangeLabel}</span>
        </div>

        <p className="empty-state">No trend data available yet.</p>
      </div>
    );
  }

  const {
    width,
    height,
    paddingLeft,
    paddingRight,
    paddingTop,
    paddingBottom,
    lineWidth,
    pointRadius,
    xAxisLabelOffset,
    yAxisLabelOffsetX,
    yAxisLabelOffsetY
  } = APP_CONFIG.charts.ownerLineChart;

  const allValues = data.flatMap((row) =>
    series.map((item) => Number((row as any)[item.key]) || 0)
  );

  const maxValue = Math.max(...allValues, 1);
  const minValue = 0;
  const range = Math.max(maxValue - minValue, 1);
  const midValue = maxValue / 2;

  const yForValue = (value: number) =>
    height -
    paddingBottom -
    ((value - minValue) / range) * (height - paddingTop - paddingBottom);

  const xForIndex = (index: number) =>
    data.length <= 1
      ? width / 2
      : paddingLeft + (index * (width - paddingLeft - paddingRight)) / (data.length - 1);

  const palette = ['#22c55e', '#38bdf8', '#f59e0b', '#a78bfa', '#fb7185', '#14b8a6', '#f97316'];

  return (
    <div className="trend-chart-card">
      <div className="trend-chart-header">
        <div>
          <h3>{label}</h3>
          <p>{subtitle}</p>
        </div>
        <span>{APP_CONFIG.charts.trendRangeLabel}</span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="owner-line-chart" role="img">
        {[maxValue, midValue, minValue].map((tickValue) => (
          <g key={tickValue}>
            <line
              x1={paddingLeft}
              y1={yForValue(tickValue)}
              x2={width - paddingRight}
              y2={yForValue(tickValue)}
              className="owner-chart-grid-line"
            />
            <text x={paddingLeft - yAxisLabelOffsetX} y={yForValue(tickValue) + yAxisLabelOffsetY} textAnchor="end">
              {Math.round(tickValue)}
            </text>
          </g>
        ))}

        {series.map((item, seriesIndex) => {
          const points = data.map((row, index) => {
            const x = xForIndex(index);
            const value = Number((row as any)[item.key]) || 0;
            const y = yForValue(value);

            return {
              x,
              y,
              label: String((row as any).date),
              value
            };
          });

          const linePoints = points.map((point) => `${point.x},${point.y}`).join(' ');
          const color = palette[seriesIndex % palette.length];

          return (
            <g key={item.key}>
              <polyline
                points={linePoints}
                fill="none"
                stroke={color}
                strokeWidth={lineWidth}
              />

              {points.map((point, index) => (
                <g key={`${item.key}-${index}`}>
                  <circle cx={point.x} cy={point.y} r={pointRadius} fill={color} />
                  <title>
                    {item.label} on {point.label}: {point.value} {valueLabel}
                  </title>
                </g>
              ))}
            </g>
          );
        })}

        {data.map((row, index) => (
          <text
            key={String((row as any).date)}
            x={xForIndex(index)}
            y={height - xAxisLabelOffset}
            textAnchor="middle"
          >
            {String((row as any).date)}
          </text>
        ))}
      </svg>

      <div className="trend-legend">
        {series.map((item, index) => (
          <span key={item.key}>
            <i className={`legend-color-${index % palette.length}`} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}


// Draws a simpler one-line SVG chart, used for totals such as total sales over the last 7 days.
function SimpleLineChart({
  data,
  xKey,
  yKey,
  label,
  valuePrefix = '',
  valueSuffix = ''
}: {
  data: Array<any>;
  xKey: string;
  yKey: string;
  label: string;
  valuePrefix?: string;
  valueSuffix?: string;
}) {
  const {
    width,
    height,
    paddingLeft,
    paddingRight,
    paddingTop,
    paddingBottom,
    lineWidth,
    pointRadius,
    xAxisLabelOffset,
    yAxisLabelOffsetX,
    yAxisLabelOffsetY
  } = APP_CONFIG.charts.simpleLineChart;

  const values = data.map((item: any) => Number(item[yKey]) || 0);
  const rawMaxValue = Math.max(...values, 0);
  const maxValue = rawMaxValue <= 0 ? 1 : rawMaxValue;
  const minValue = 0;
  const range = Math.max(maxValue - minValue, 1);
  const midValue = maxValue / 2;
  const valueDecimals = valuePrefix ? 2 : 0;

  const formatValue = (value: number) => {
    return `${valuePrefix}${value.toFixed(valueDecimals)}${valueSuffix}`;
  };

  const points = data.map((item: any, index: number) => {
    const x =
      data.length <= 1
        ? width / 2
        : paddingLeft + (index * (width - paddingLeft - paddingRight)) / (data.length - 1);

    const y =
      height -
      paddingBottom -
      ((Number(item[yKey]) - minValue) / range) * (height - paddingTop - paddingBottom);

    return {
      x,
      y,
      label: String(item[xKey]),
      value: Number(item[yKey]) || 0
    };
  });

  const polylinePoints = points.map((point) => `${point.x},${point.y}`).join(' ');

  const yForValue = (value: number) =>
    height -
    paddingBottom -
    ((value - minValue) / range) * (height - paddingTop - paddingBottom);

  return (
    <div className="simple-chart-card">
      <div className="simple-chart-top">
        <strong>{label}</strong>
        <span>{APP_CONFIG.charts.trendRangeLabel}</span>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="simple-line-chart" role="img">
        {[maxValue, midValue, minValue].map((tickValue) => (
          <g key={tickValue}>
            <line
              x1={paddingLeft}
              y1={yForValue(tickValue)}
              x2={width - paddingRight}
              y2={yForValue(tickValue)}
              className="simple-chart-grid-line"
            />
            <text x={paddingLeft - yAxisLabelOffsetX} y={yForValue(tickValue) + yAxisLabelOffsetY} textAnchor="end">
              {formatValue(tickValue)}
            </text>
          </g>
        ))}

        <line
          x1={paddingLeft}
          y1={height - paddingBottom}
          x2={width - paddingRight}
          y2={height - paddingBottom}
          className="simple-chart-axis"
        />

        {points.length > 1 && (
          <polyline points={polylinePoints} fill="none" strokeWidth={lineWidth} />
        )}

        {points.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <circle cx={point.x} cy={point.y} r={pointRadius} />
            <title>
              {point.label}: {formatValue(point.value)}
            </title>
            <text x={point.x} y={height - xAxisLabelOffset} textAnchor="middle">
              {point.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
//#endregion

//#region Customer shopping components

// Renders a single row for a fruit in the catalog with input validation
// Displays one fruit card in the customer store page.
// It decides whether to show Add to Cart or quantity +/- controls based on the current cart quantity.
function FruitCatalogueCard({fruit, cart, cartInterestCount, updateCartItemQuantity} : FruitCatalogueCardProps) {
  const existingIteminCart = cart.find((item) => item.id === fruit.id);
  const cartQuantity = existingIteminCart ? existingIteminCart.quantity : 0;
  
  const isOutOfStock = fruit.stock === 0;
  const isCartAtMaxStock = cartQuantity >= fruit.stock;
  const isCartInterestAtOrAboveStock = fruit.stock > 0 && cartInterestCount >= fruit.stock;

  // Reuses the shared quantity input logic instead of duplicating handlers inside this component.
  const {
    quantityInput,
    handleQuantityChange,
    handleQuantityBlur,
    handleQuantityKeyDown
  } = useQuantityInput({
    itemId: fruit.id,
    currentQuantity: cartQuantity,
    maxQuantity: fruit.stock,
    updateCartItemQuantity
  });

  return (
    <article className="fruit-card">
      <div className="fruit-main">
        <div>
          <p className="eyebrow">Fruit Item</p>
          <h2 className="fruit-name">{fruit.name}</h2>

          <div className="meta-row">
            <span className="meta-pill">${Number(fruit.price).toFixed(2)}</span>

            <span className={`meta-pill ${isOutOfStock ? 'stock-out' : fruit.stock <= APP_CONFIG.lowStockThreshold ? 'stock-low' : ''}`}>
              {isOutOfStock ? 'Out of stock' : `${fruit.stock} in stock`}
            </span>

            {cartInterestCount > 0 && (
              <span
                className={`meta-pill ${
                  isCartInterestAtOrAboveStock ? 'cart-interest-warning' : ''
                }`}
              >
                {cartInterestCount} in other carts
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="fruit-actions">
        {cartQuantity === 0 ? (
          <button
            type="button"
            disabled={isOutOfStock}
            onClick={() => updateCartItemQuantity(fruit.id, 1)}
          >
            {isOutOfStock ? 'Unavailable' : 'Add to Cart'}
          </button>
        ) : (
          <div className="quantity-control">
            <button
              type="button"
              className="secondary-button quantity-button"
              onClick={() => updateCartItemQuantity(fruit.id, cartQuantity - 1)}
            >
              -
            </button>

            <input
              className="quantity-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={quantityInput}
              onChange={(e) => handleQuantityChange(e.target.value)}
              onBlur={handleQuantityBlur}
              onKeyDown={handleQuantityKeyDown}
            />

            <button
              type="button"
              className="secondary-button quantity-button"
              disabled={isCartAtMaxStock}
              onClick={() => updateCartItemQuantity(fruit.id, cartQuantity + 1)}
            >
              +
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

// Displays one fruit row inside the cart.
// It lets the user increase/decrease/remove that fruit while respecting available stock.
function CartItemRow({cartItem, maxStock, updateCartItemQuantity}: CartItemRowProps) {
  // Reuses the shared quantity input logic instead of duplicating handlers inside this component.
  const {
    quantityInput,
    handleQuantityChange,
    handleQuantityBlur,
    handleQuantityKeyDown
  } = useQuantityInput({
    itemId: cartItem.id,
    currentQuantity: cartItem.quantity,
    maxQuantity: maxStock,
    updateCartItemQuantity
  });

   return (
    <div className="cart-item" key={cartItem.id}>
      <div className="cart-item-top">
        <div className="cart-item-info">
          <div>
            <h3 className="cart-item-title">{cartItem.name}</h3>
            <p className="cart-item-price">
              ${Number(cartItem.price).toFixed(2)} each
            </p>
          </div>

          <div className="cart-item-subtotal">
            <span>Item total</span>
            <strong>
              ${(Number(cartItem.price) * cartItem.quantity).toFixed(2)}
            </strong>
          </div>
        </div>

        <span className="meta-pill">
          Qty {cartItem.quantity}
        </span>
      </div>

      <div className="quantity-control cart-quantity-control">
        <button
          type="button"
          className="secondary-button quantity-button"
          onClick={() => updateCartItemQuantity(cartItem.id, cartItem.quantity - 1)}
        >
          −
        </button>

        <input
          className="quantity-input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={quantityInput}
          onChange={(e) => handleQuantityChange(e.target.value)}
          onBlur={handleQuantityBlur}
          onKeyDown={handleQuantityKeyDown}
        />

        <button
          type="button"
          className="secondary-button quantity-button"
          disabled={cartItem.quantity >= maxStock}
          onClick={() => updateCartItemQuantity(cartItem.id, cartItem.quantity + 1)}
        >
          +
        </button>

        <button
          type="button"
          className="danger-button"
          onClick={() => updateCartItemQuantity(cartItem.id, 0)}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

// Renders the summary of items ready for purchase and handles total cost calculations
// Displays the customer's cart summary, item totals, grand total, checkout button, and clear-cart button.
function CartSummary({cart, fruitCatalogue, updateCartItemQuantity, removeAllFromCart, checkoutCart}: CartSummaryProps) {
  const isCartEmpty = cart.length === 0;
  const totalCartPrice = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

  return (
    <aside className="cart-card">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Cart</h2>
          <p className="panel-subtitle">
            Review selected items before checkout.
          </p>
        </div>
      </div>

      {isCartEmpty ? (
        <p className="empty-state">Your cart is empty.</p>
      ) : (
        <div className="cart-list">
          {cart.map((cartItem) => {
            const matchingFruit = fruitCatalogue.find((fruit) => fruit.id === cartItem.id);
            const maxStock = matchingFruit ? matchingFruit.stock : cartItem.quantity;

            return (
              <CartItemRow
                key={cartItem.id}
                cartItem={cartItem}
                maxStock={maxStock}
                updateCartItemQuantity={updateCartItemQuantity}
              />
            );
          })}
        </div>
      )}

      <div className="cart-total">
        <p className="stat-label">Total</p>
        <h2>${totalCartPrice.toFixed(2)}</h2>
      </div>

      <div className="cart-actions">
        <button
          type="button"
          disabled={isCartEmpty}
          onClick={checkoutCart}
        >
          Checkout
        </button>

        <button
          type="button"
          className="danger-button"
          disabled={isCartEmpty}
          onClick={removeAllFromCart}
        >
          Clear Cart
        </button>
      </div>
    </aside>
  );
}

//#endregion

//#region Order display and history components

// Reusable table for showing the fruits inside an order.
// Both customer order history and owner submitted orders use the same item-table layout.
function OrderItemsTable({ items }: { items: OrderItem[] }) {
  return (
    <div className="clean-items-table">
      <div className="clean-items-head">
        <span>Item</span>
        <span>Qty</span>
        <span>Unit Price</span>
        <span>Subtotal</span>
      </div>

      {items.map((item) => (
        <div className="clean-items-row" key={item.orderItemId || item.fruitId}>
          <span>{item.name}</span>
          <span>{item.quantity}</span>
          <span>${Number(item.priceAtPurchase).toFixed(2)}</span>
          <span>${(item.quantity * Number(item.priceAtPurchase)).toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}

// Renders a single order ticket block for the owner dashboard view
// Displays one submitted order in the owner dashboard, including customer name, date, total, and item list.
function OwnerOrderCard({order} : OwnerOrderCardProps) {
  return (
    <article className="clean-order-card">
      <div className="clean-order-main">
        <div>
          <p className="clean-label">Order</p>
          <h3>#{shortenOrderId(order.orderId)}</h3>
        </div>

        <div>
          <p className="clean-label">Customer</p>
          <p className="clean-value">{order.username}</p>
        </div>

        <div>
          <p className="clean-label">Submitted</p>
          <p className="clean-value">{formatSgDateTime(order.createdAt)}</p>
        </div>

        <div className="clean-total-box">
          <p className="clean-label">Total</p>
          <p className="clean-total">${Number(order.totalAmount).toFixed(2)}</p>
        </div>
      </div>

      <OrderItemsTable items={order.items} />
    </article>
  );
}

// Displays the logged-in customer's previous orders.
// The refreshTrigger number changes after checkout so this component knows to reload order history.
function OrderHistory({ onReorder, refreshTrigger }: {onReorder: (items: OrderItem[]) => Promise<void>; refreshTrigger: number; }) {
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [error, setError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const orderHistoryItemsPerPage = APP_CONFIG.pagination.customerOrderHistoryItemsPerPage;

  // When this component opens/refreshes, load the logged-in customer's order history from the backend.
  useEffect(() => {
    const token = localStorage.getItem('fruitStore_token');

    if (!token) return;

    apiRequest<CustomerOrder[]>(
      `${API_URL}/api/my-orders`,
      { headers: getAuthHeaders(token) },
      'Failed to load order history'
    )
      .then(setOrders)
      .catch((err) => setError(err.message));
  }, [refreshTrigger]);

  useEffect(() => {
    setCurrentPage(1);
  }, [refreshTrigger, orders.length]);

    if (error) {
    return <p className="error-text">{error}</p>;
  }

  const {
    safePage: safeOrderHistoryPage,
    paginatedItems: paginatedOrders
  } = getPaginatedItems(orders, currentPage, orderHistoryItemsPerPage);

  return (
    <section className="history-card">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">My Order History</h2>
          <p className="panel-subtitle">
            View past purchases and reorder quickly.
          </p>
        </div>
      </div>

      {orders.length === 0 ? (
        <p className="empty-state">No previous orders yet.</p>
      ) : (
        <div className="clean-order-list">
          {paginatedOrders.map((order: CustomerOrder) => (
            <article className="clean-order-card" key={order.orderId}>
              <div className="clean-order-main">
                <div>
                  <p className="clean-label">Order</p>
                  <h3>#{shortenOrderId(order.orderId)}</h3>
                </div>

                <div>
                  <p className="clean-label">Date</p>
                  <p className="clean-value">{formatSgDateTime(order.createdAt)}</p>
                </div>

                <div className="clean-total-box">
                  <p className="clean-label">Total</p>
                  <p className="clean-total">${Number(order.totalAmount).toFixed(2)}</p>
                </div>

                <div className="clean-action-box">
                  <button onClick={() => onReorder(order.items)}>
                    Re-order & Checkout
                  </button>
                </div>
              </div>

              <OrderItemsTable items={order.items} />
            </article>
          ))}
        </div>
      )}

      <PaginationControls
        currentPage={safeOrderHistoryPage}
        totalItems={orders.length}
        itemsPerPage={orderHistoryItemsPerPage}
        onPageChange={setCurrentPage}
      />
    </section>
  );
}

//#endregion

//#region Customer floating chat component

// Floating chat widget for customers.
// It supports two modes: AI bot actions and messaging the store owner.
function FloatingCustomerChat({ cart, setCart, onAfterAgentCheckout }: FloatingCustomerChatProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<ChatMode>('bot');
  const [input, setInput] = useState('');
  const [botMessages, setBotMessages] = useState<ChatLine[]>([
    {
      role: 'bot',
      text: 'Hi! I can answer store questions, add fruits to your basket, help you checkout, or answer general fruit questions.'
    }
  ]);
  const [ownerMessages, setOwnerMessages] = useState<CustomerMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [ownerLoading, setOwnerLoading] = useState(false);
  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  const bottomOfChatRef = useRef<HTMLDivElement | null>(null);
  const [ownerSentNotice, setOwnerSentNotice] = useState('');

  const token = localStorage.getItem('fruitStore_token');

  // Calls the backend to load the current customer's message history with the owner.
  const fetchOwnerMessages = async () => {
    if (!token) return;

    try {
      const data = await apiRequest<CustomerMessage[]>(
        `${API_URL}/api/my-messages`,
        { headers: getAuthHeaders(token) },
        'Failed to fetch owner messages'
      );

      setOwnerMessages(data);
    } catch (err: any) {
      setBotMessages((prev) => [
        ...prev,
        {
          role: 'system',
          text: err.message || 'Failed to fetch owner messages.'
        }
      ]);
    }
  };

  useEffect(() => {
    if (isOpen && mode === 'owner') {
      fetchOwnerMessages();
    }
  }, [isOpen, mode]);

  useEffect(() => {
    if (!isOpen) return;

    const scrollTimer = window.setTimeout(() => {
      bottomOfChatRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'end'
      });
    }, APP_CONFIG.chat.autoScrollDelayMs);

    return () => window.clearTimeout(scrollTimer);
  }, [isOpen, mode, botMessages, ownerMessages, loading, ownerLoading]);

  // Sends the customer's message, current cart, and recent chat history to the backend AI shopping agent.
  const sendToBot = async (trimmedInput: string) => {
    if (!token) {
      setBotMessages((prev) => [
        ...prev,
        { role: 'system', text: 'Please log in as a customer before using the bot.' }
      ]);
      return;
    }

    const isCheckoutRequest = /checkout|check out|buy|pay|purchase|place order/i.test(trimmedInput);

    if (isCheckoutRequest) {
      const confirmed = window.confirm('The bot may checkout your basket. Continue?');

      if (!confirmed) {
        setBotMessages((prev) => [
          ...prev,
          { role: 'system', text: 'Checkout cancelled.' }
        ]);
        return;
      }
    }

    setBotMessages((prev) => [...prev, { role: 'user', text: trimmedInput }]);

    try {
      setLoading(true);

      const response = await fetch(`${API_URL}/api/agent`, {
        method: 'POST',
        headers: getAuthHeaders(token, true),
        body: JSON.stringify({
          message: trimmedInput,
          cart,
          conversationHistory: botMessages.slice(-APP_CONFIG.chat.conversationHistoryLimit).map((message) => ({
            role: message.role,
            text: message.text
          }))
        })
      });

      const responseText = await response.text();
      let data: any = null;

      try {
        data = responseText ? JSON.parse(responseText) : null;
      } catch {
        data = null;
      }

      if (!response.ok) {
        const htmlErrorMatch = responseText.match(/<pre>(.*?)<\/pre>/s);
        const readableHtmlError = htmlErrorMatch?.[1]?.replace(/<[^>]+>/g, '').trim();

        throw new Error(
          data?.error ||
          data?.details ||
          readableHtmlError ||
          'The shopping bot failed to respond. Check that the backend /api/agent route is deployed.'
        );
      }

      if (Array.isArray(data?.cart)) {
        const cleanCart = data.cart
          .filter((item: any) =>
            item?.id &&
            Number.isFinite(Number(item.price)) &&
            Number.isInteger(Number(item.quantity)) &&
            Number(item.quantity) > 0
          )
          .map((item: any) => ({
            id: String(item.id),
            name: String(item.name || ''),
            price: Number(item.price),
            quantity: Number(item.quantity)
          }));

        setCart(cleanCart);
        localStorage.setItem('fruitStore_cart', JSON.stringify(cleanCart));
      }

      if (data?.checkedOut || data?.action === 'checkout') {
        setCart([]);
        localStorage.removeItem('fruitStore_cart');
        await onAfterAgentCheckout();
      }

      setBotMessages((prev) => [
        ...prev,
        {
          role: 'bot',
          text: data?.reply || 'Done.'
        }
      ]);
    } catch (err: any) {
      setBotMessages((prev) => [
        ...prev,
        {
          role: 'system',
          text: err.message || 'The shopping bot failed to respond.'
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  // Saves the customer's question in the database so the owner can reply later.
  const sendToOwner = async (trimmedInput: string) => {
    if (!token) {
      setBotMessages((prev) => [
        ...prev,
        { role: 'system', text: 'Please log in as a customer before messaging the owner.' }
      ]);
      return;
    }

    try {
      setOwnerLoading(true);

      const data = await apiRequest<any>(
        `${API_URL}/api/messages`,
        {
          method: 'POST',
          headers: getAuthHeaders(token, true),
          body: JSON.stringify({ question: trimmedInput })
        },
        'Failed to send message to owner'
      );

      setOwnerSentNotice('Message sent to owner.');

      setOwnerMessages((prev) => [
        {
          messageId: data?.customerMessage?.messageId || `local-${Date.now()}`,
          question: trimmedInput,
          reply: null,
          status: 'pending',
          createdAt: new Date().toISOString(),
          repliedAt: null
        },
        ...prev
      ]);

      await fetchOwnerMessages();
    } catch (err: any) {
      setBotMessages((prev) => [
        ...prev,
        {
          role: 'system',
          text: err.message || 'Failed to send message to owner.'
        }
      ]);
    } finally {
      setOwnerLoading(false);
    }
  };

  // Decides whether to send the typed message to the AI bot or to the owner based on the active chat tab.
  const sendMessage = async () => {
    const trimmedInput = input.trim();

    if (!trimmedInput) return;

    setInput('');

    if (mode === 'bot') {
      await sendToBot(trimmedInput);
    } else {
      await sendToOwner(trimmedInput);
    }
  };

  const isBusy = loading || ownerLoading;

  return (
    <div className="floating-chat-shell">
      {isOpen && (
        <section className="floating-chat-window">
          <div className="floating-chat-header">
            <div>
              <p className="floating-chat-kicker">Fruit Store Chat</p>
              <h3>{mode === 'bot' ? 'Shopping Bot' : 'Message Owner'}</h3>
            </div>

            <button
              type="button"
              className="floating-chat-close"
              onClick={() => setIsOpen(false)}
              aria-label="Close chat"
            >
              x
            </button>
          </div>

          <div className="floating-chat-tabs">
            <button
              type="button"
              className={mode === 'bot' ? 'active' : ''}
              onClick={() => setMode('bot')}
            >
              AI Bot
            </button>

            <button
              type="button"
              className={mode === 'owner' ? 'active' : ''}
              onClick={() => setMode('owner')}
            >
              Owner
            </button>
          </div>

          <div className="floating-chat-body" ref={chatBodyRef}>
            {mode === 'bot' ? (
              botMessages.map((message, index) => (
                <div
                  className={`chat-bubble ${
                    message.role === 'user'
                      ? 'user'
                      : message.role === 'system'
                      ? 'system'
                      : 'bot'
                  }`}
                  key={`${message.role}-${index}`}
                >
                  {message.text}
                </div>
              ))
            ) : (
              <div className="owner-chat-panel">
                <p className="owner-chat-help">
                  Send a message to the store owner. Replies will appear here once answered.
                </p>


                {ownerSentNotice && (
                  <div className="chat-bubble system">{ownerSentNotice}</div>
                )}

                {ownerMessages.length === 0 ? (
                  <p className="empty-state compact">No owner messages yet.</p>
                ) : (
                  ownerMessages.map((message) => (
                    <article className="owner-message-card" key={message.messageId}>
                      <p><strong>You:</strong> {message.question}</p>
                      <p><strong>Owner:</strong> {message.reply || 'No reply yet.'}</p>
                      <small>
                        {message.status} · {formatSgDateTime(message.createdAt)}
                      </small>
                    </article>
                  ))
                )}
              </div>
            )}
            <div ref={bottomOfChatRef} />
          </div>

          <div className="floating-chat-input-row">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  sendMessage();
                }
              }}
              placeholder={
                mode === 'bot'
                  ? `Try: Add ${APP_CONFIG.chat.placeholderExampleQuantity} apples in my cart.`
                  : 'Type a message for the owner'
              }
              disabled={isBusy}
            />

            <button
              type="button"
              onClick={sendMessage}
              disabled={isBusy || !input.trim()}
            >
              {isBusy ? '...' : 'Send'}
            </button>
          </div>
        </section>
      )}

      <button
        type="button"
        className="floating-chat-launcher"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label={isOpen ? 'Close chat' : 'Open chat'}
        title={isOpen ? 'Close chat' : 'Open chat'}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
        </svg>
      </button>
    </div>
  );
}


//#endregion

//#region Owner messaging component

// Owner inbox screen section. It lets the owner read customer questions and submit replies.
function OwnerMessages() {
  const [messages, setMessages] = useState<OwnerMessage[]>([]);
  const [replyInputs, setReplyInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const token = localStorage.getItem('fruitStore_token');

  // Calls the backend to load the current customer's message history with the owner.
  const fetchOwnerMessages = async () => {
    if (!token) return;

    try {
      const data = await apiRequest<OwnerMessage[]>(
        `${API_URL}/api/owner/messages`,
        { headers: getAuthHeaders(token) },
        'Failed to fetch customer messages'
      );

      setMessages(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch customer messages');
    }
  };

  useEffect(() => {
    fetchOwnerMessages();
  }, []);

  // Lets the owner send a reply to one pending customer question.
  const replyToMessage = async (messageId: string) => {
    const reply = replyInputs[messageId];

    if (!reply || !reply.trim()) {
      alert('Please type a reply first.');
      return;
    }

    try {
      await apiRequest(
        `${API_URL}/api/owner/messages/${messageId}/reply`,
        {
          method: 'PUT',
          headers: getAuthHeaders(token, true),
          body: JSON.stringify({ reply })
        },
        'Failed to send reply'
      );

      setReplyInputs((prev) => {
        const next = { ...prev };
        delete next[messageId];
        return next;
      });

      await fetchOwnerMessages();
      alert('Reply sent successfully!');
    } catch (err: any) {
      alert(err.message || 'Failed to send reply');
    }
  };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Customer Messages</h2>
          <p className="panel-subtitle">
            View customer questions and reply as an owner.
          </p>
        </div>

        <button
          type="button"
          className="secondary-button"
          onClick={fetchOwnerMessages}
        >
          Refresh
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}

      {messages.length === 0 ? (
        <p className="empty-state">No customer messages yet.</p>
      ) : (
        <div className="clean-order-list">
          {messages.map((message) => (
            <article className="clean-order-card" key={message.messageId}>
              <div className="clean-order-main">
                <div>
                  <p className="clean-label">Customer</p>
                  <h3>{message.customerUsername}</h3>
                </div>

                <div>
                  <p className="clean-label">Status</p>
                  <p className="clean-value">{message.status}</p>
                </div>

                <div>
                  <p className="clean-label">Sent</p>
                  <p className="clean-value">{formatSgDateTime(message.createdAt)}</p>
                </div>

                {message.repliedByOwner && (
                  <div>
                    <p className="clean-label">Replied By</p>
                    <p className="clean-value">{message.repliedByOwner}</p>
                  </div>
                )}
              </div>

              <div className="message-thread">
                <p>
                  <strong>Customer question:</strong> {message.question}
                </p>

                {message.reply ? (
                  <p>
                    <strong>Owner reply:</strong> {message.reply}
                  </p>
                ) : (
                  <div className="reply-box">
                    <textarea
                      value={replyInputs[message.messageId] || ''}
                      onChange={(e) =>
                        setReplyInputs((prev) => ({
                          ...prev,
                          [message.messageId]: e.target.value
                        }))
                      }
                      placeholder="Type your reply to the customer..."
                      rows={APP_CONFIG.ownerMessages.replyTextareaRows}
                    />

                    <button
                      type="button"
                      onClick={() => replyToMessage(message.messageId)}
                    >
                      Send Reply
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

//#endregion

//#region Owner dashboard page

// Dashboard page intended for administrative/owner tracking uses
// Main owner dashboard page.
// It loads orders, fruits, sales summaries, stock alerts, and owner messages.
function OwnerPage() {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [orders, setOrders] = useState<OwnerOrder[]>([]);
  const [fruitCatalogue, setFruitCatalogue] = useState<Fruit[]>([]);
  const [dailySalesSummary, setDailySalesSummary] = useState<DailySalesSummary | null>(null);

  const [manageCataloguePage, setManageCataloguePage] = useState(1);
  const [submittedOrdersPage, setSubmittedOrdersPage] = useState(1);
  const manageCatalogueItemsPerPage = APP_CONFIG.pagination.ownerManageCatalogueItemsPerPage;
  const submittedOrdersItemsPerPage = APP_CONFIG.pagination.ownerSubmittedOrdersItemsPerPage;

  const [newFruitName, setNewFruitName] = useState('');
  const [newFruitPrice, setNewFruitPrice] = useState('');
  const [newFruitStock, setNewFruitStock] = useState('');

  const [fruitEdits, setFruitEdits] = useState<Record<string, {
    name: string;
    price: string;
    stock: string;
  }>>({});

  const token = localStorage.getItem('fruitStore_token');

  // Loads all owner dashboard data from backend endpoints: fruit catalogue, submitted orders, and daily sales summary.
  const fetchOwnerData = async (showFullPageLoading = false) => {
    try {
      if (showFullPageLoading) {
        setLoading(true);
      }

      setError(null);

      const [ordersData, fruitsData, summaryData] = await Promise.all([
        apiRequest<OwnerOrder[]>(
          `${API_URL}/api/orders`,
          { headers: getAuthHeaders(token) },
          'Failed to fetch orders'
        ),

        apiRequest<Fruit[]>(`${API_URL}/api/fruits`, undefined, 'Failed to fetch fruit catalogue'),

        apiRequest<DailySalesSummary>(
          `${API_URL}/api/owner/daily-summary`,
          { headers: getAuthHeaders(token) },
          'Failed to fetch daily summary'
        )
      ]);

      setOrders(ordersData);
      setFruitCatalogue(fruitsData);
      setDailySalesSummary(summaryData);
    } catch (err: any) {
      setError(err.message || 'Failed to load owner page');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOwnerData(true);
  }, []);

  useEffect(() => {
    setManageCataloguePage(1);
  }, [fruitCatalogue.length]);

  useEffect(() => {
    setSubmittedOrdersPage(1);
  }, [orders.length]);

  // Sends the new fruit form to the backend so the owner can add/reactivate a fruit.
  const createFruit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const data = await apiRequest<any>(
        `${API_URL}/api/owner/fruits`,
        {
          method: 'POST',
          headers: getAuthHeaders(token, true),
          body: JSON.stringify({
            name: newFruitName,
            price: Number(newFruitPrice),
            stock: Number(newFruitStock)
          })
        },
        'Failed to create fruit'
      );

      if (data?.fruit) {
        setFruitCatalogue((prev) => [...prev, data.fruit]);
      }

      setNewFruitName('');
      setNewFruitPrice('');
      setNewFruitStock('');

      fetchOwnerData(false);
      alert('Fruit created successfully');
    } catch (err: any) {
      alert(err.message || 'Failed to create fruit');
    }
  };

  // Sends edited fruit name/price/stock to the backend for one existing fruit.
  const updateFruit = async (fruitId: string) => {
    const edit = fruitEdits[fruitId];

    if (!edit) {
      alert('No Changes found');
      return;
    }

    try {
      const data = await apiRequest<any>(
        `${API_URL}/api/owner/fruits/${fruitId}`,
        {
          method: 'PUT',
          headers: getAuthHeaders(token, true),
          body: JSON.stringify({
            name: edit.name,
            price: Number(edit.price),
            stock: Number(edit.stock)
          })
        },
        'Failed to update stock'
      );

      if (data?.fruit) {
        setFruitCatalogue((prev) => prev.map((fruit) => fruit.id === fruitId ? data.fruit : fruit));
      }

      setFruitEdits((prev) => {
        const next = { ...prev };
        delete next[fruitId];
        return next;
      });

      fetchOwnerData(false);
      alert('Fruit updated successfully');
    } catch (err: any) {
      alert(err.message || 'Failed to update fruit');
    }
  };

  // Soft-deletes a fruit by asking the backend to mark it inactive instead of permanently removing past sales history.
  const deleteFruit = async (fruitId: string) => {
    const confirmDelete = window.confirm('Are you sure you want to remove this fruit?');

    if (!confirmDelete) return;

    try {
      await apiRequest(
        `${API_URL}/api/owner/fruits/${fruitId}`,
        {
          method: 'DELETE',
          headers: getAuthHeaders(token)
        },
        'Failed to remove fruit'
      );

      setFruitCatalogue(prev => prev.filter((fruit) => fruit.id !== fruitId))

      setFruitEdits((prev) => {
        const next = { ...prev };
        delete next[fruitId];
        return next;
      })

      fetchOwnerData(false);
      alert('Fruit removed successfully');
    } catch (err: any) {
      alert(err.message || 'Failed to remove fruit');
    }
  };

  if (loading) return <div className="loading-card">Loading Owner page...</div>;
  if (error) return <div className="error-card">Error: {error}</div>;

  const totalSalesTrendData = dailySalesSummary?.totalSalesTrend || [];

  const {
    safePage: safeManageCataloguePage,
    paginatedItems: paginatedManageCatalogue
  } = getPaginatedItems(fruitCatalogue, manageCataloguePage, manageCatalogueItemsPerPage);

  const {
    safePage: safeSubmittedOrdersPage,
    paginatedItems: paginatedSubmittedOrders
  } = getPaginatedItems(orders, submittedOrdersPage, submittedOrdersItemsPerPage);

  return (
    <main className="owner-layout">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h1>Owner Dashboard</h1>
            <p className="panel-subtitle">
              Manage fruit listings, stock levels, and daily sales performance.
            </p>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Today's Sales Summary</h2>
            <p className="panel-subtitle">
              A quick overview of today's fruit store activity.
            </p>
          </div>
        </div>

        {dailySalesSummary ? (
          <>
            <div className="owner-stats">
              <div className="stat-card">
                <p className="stat-label">Date</p>
                <p className="stat-value">{dailySalesSummary.date}</p>
              </div>

              <div className="stat-card">
                <p className="stat-label">Total Orders</p>
                <p className="stat-value">{dailySalesSummary.totalOrders}</p>
              </div>

              <div className="stat-card">
                <p className="stat-label">Total Sales</p>
                <p className="stat-value">
                  ${Number(dailySalesSummary.totalSales).toFixed(2)}
                </p>
              </div>
            </div>

            <div className="sales-breakdown-header">
              <div>
                <h3>Sales by Fruit</h3>
                <p className="panel-subtitle">
                  Breakdown of today’s quantity sold and revenue by fruit.
                </p>
              </div>
            </div>

            {dailySalesSummary.fruitSalesSummary.length === 0 ? (
              <p className="empty-state">No sales today yet.</p>
            ) : (
              <div className="sales-breakdown-table">
                <div className="sales-breakdown-head">
                  <span>Fruit</span>
                  <span>Quantity Sold</span>
                  <span>Total Sales</span>
                </div>

                {dailySalesSummary.fruitSalesSummary.map((fruit) => (
                  <div className="sales-breakdown-row" key={fruit.fruitId}>
                    <span>{fruit.name}</span>
                    <span>{fruit.quantitySold}</span>
                    <span>${Number(fruit.sales).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="empty-state">No summary available.</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Fruit Trends</h2>
            <p className="panel-subtitle">
              Track fruits ordered across the selected trend period.
            </p>
          </div>
        </div>

        <div className="analytics-grid">
          <OwnerLineChart
            label="Fruit Quantity Ordered"
            subtitle="Daily units ordered by fruit."
            chart={dailySalesSummary?.fruitOrdersTrend}
            valueLabel="ordered"
          />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Total Sales Trend</h2>
            <p className="panel-subtitle">
              Daily total sales revenue based on completed customer orders.
            </p>
          </div>
        </div>

        {totalSalesTrendData.length === 0 ? (
          <p className="empty-state">No sales trend data available yet.</p>
        ) : (
          <SimpleLineChart
            data={totalSalesTrendData}
            xKey="date"
            yKey="totalSales"
            label="Total Sales"
            valuePrefix="$"
          />
        )}
      </section>

      <section className="panel out-of-stock-panel">
        <div className="panel-header out-of-stock-header">
          <div>
            <p className="alert-eyebrow">Stock Alert</p>
            <h2 className="panel-title out-of-stock-title">
              ⚠️ Out of Stock Items
            </h2>
            <p className="panel-subtitle">
              Active fruit listings that currently have zero stock and need owner attention.
            </p>
          </div>

          <div className="out-of-stock-count">
            <strong>{dailySalesSummary?.outOfStockFruits?.length ?? 0}</strong>
            <span>items</span>
          </div>
        </div>

        {!dailySalesSummary?.outOfStockFruits || dailySalesSummary.outOfStockFruits.length === 0 ? (
          <p className="empty-state success-state">No items are out of stock right now.</p>
        ) : (
          <div className="out-of-stock-grid">
            {dailySalesSummary.outOfStockFruits.map((fruit) => (
              <article className="out-of-stock-card" key={fruit.id}>
                <p className="eyebrow danger-eyebrow">Needs restock</p>
                <h3>{fruit.name}</h3>
                <p>
                  ${Number(fruit.price).toFixed(2)} · Current stock: <strong>{fruit.stock}</strong>
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Create New Fruit</h2>
            <p className="panel-subtitle">
              Add a new fruit item to your catalogue.
            </p>
          </div>
        </div>

        <form className="create-form" onSubmit={createFruit}>
          <input
            type="text"
            placeholder="Fruit name"
            value={newFruitName}
            onChange={(e) => setNewFruitName(e.target.value)}
          />

          <input
            type="number"
            placeholder="Price"
            value={newFruitPrice}
            onChange={(e) => setNewFruitPrice(e.target.value)}
          />

          <input
            type="number"
            placeholder="Stock"
            value={newFruitStock}
            onChange={(e) => setNewFruitStock(e.target.value)}
          />

          <button type="submit">
            Create Fruit
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Manage Catalogue</h2>
            <p className="panel-subtitle">
              Update fruit details, prices, and stock levels.
            </p>
          </div>
        </div>

        <div className="owner-grid">
          {paginatedManageCatalogue.map((fruit: Fruit) => {
            const edit = fruitEdits[fruit.id] || {
              name: fruit.name,
              price: String(fruit.price),
              stock: String(fruit.stock)
            };

            return (
              <article className="manage-card" key={fruit.id}>
                <div className="summary-top">
                  <div>
                    <h3>{fruit.name}</h3>
                    <p>
                      ${Number(fruit.price).toFixed(2)} · Current Stock: {fruit.stock}
                    </p>
                  </div>
                </div>

                <div className="edit-form">
                  <input
                    type="text"
                    placeholder="Name"
                    value={edit.name}
                    onChange={(e) =>
                      setFruitEdits((prev) => ({
                        ...prev,
                        [fruit.id]: {
                          ...edit,
                          name: e.target.value
                        }
                      }))
                    }
                  />

                  <input
                    type="number"
                    placeholder="Price"
                    value={edit.price}
                    onChange={(e) =>
                      setFruitEdits((prev) => ({
                        ...prev,
                        [fruit.id]: {
                          ...edit,
                          price: e.target.value
                        }
                      }))
                    }
                  />

                  <input
                    type="number"
                    placeholder="Stock"
                    value={edit.stock}
                    onChange={(e) =>
                      setFruitEdits((prev) => ({
                        ...prev,
                        [fruit.id]: {
                          ...edit,
                          stock: e.target.value
                        }
                      }))
                    }
                  />

                  <button onClick={() => updateFruit(fruit.id)}>
                    Update Fruit
                  </button>

                  <button
                    className="danger-button"
                    onClick={() => deleteFruit(fruit.id)}
                  >
                    Remove Fruit
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        <PaginationControls
          currentPage={safeManageCataloguePage}
          totalItems={fruitCatalogue.length}
          itemsPerPage={manageCatalogueItemsPerPage}
          onPageChange={setManageCataloguePage}
        />

      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Submitted Orders</h2>
            <p className="panel-subtitle">
              View customer orders submitted to the store.
            </p>
          </div>
        </div>

        {orders.length === 0 ? (
          <p className="empty-state">No orders submitted yet.</p>
        ) : (
          <div className="order-list">
            {paginatedSubmittedOrders.map((order: OwnerOrder) => (
              <OwnerOrderCard
                key={order.orderId}
                order={order}
              />
            ))}
          </div>
        )}
        <PaginationControls
          currentPage={safeSubmittedOrdersPage}
          totalItems={orders.length}
          itemsPerPage={submittedOrdersItemsPerPage}
          onPageChange={setSubmittedOrdersPage}
        />

      </section>

      <OwnerMessages />
    </main>
  );
}

//#endregion

//#region Customer shopping page

// Store page intended for customer interactions, purchasing, and item listing
// Main customer shopping page.
// It loads the fruit catalogue, manages the cart, handles checkout, and shows order history/chat.
function CustomerPage({ cart, setCart } : {cart: CartItem[]; setCart:Dispatch<SetStateAction<CartItem[]>>}) {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [fruitCatalogue, setFruitCatalogue] = useState<Fruit[]>([]);
  const [cartInterest, setCartInterest] = useState<Record<string, number>>({});
  const [orderHistoryRefreshTrigger, setOrderHistoryRefreshTrigger] = useState(0);
  const [fruitCataloguePage, setFruitCataloguePage] = useState(1);
  const [cartAdjustmentMessage, setCartAdjustmentMessage] = useState<string | null>(null);
  const lastCartAdjustmentSignatureRef = useRef('');
  const fruitCatalogueItemsPerPage = APP_CONFIG.pagination.customerFruitCatalogueItemsPerPage;
  
  const token = localStorage.getItem('fruitStore_token');

  // Loads active fruits from the backend so customers can see current price and stock.
  const fetchFruitCatalogue = async () => {
    try {
      const data = await apiRequest<Fruit[]>(
        `${API_URL}/api/fruits`,
        undefined,
        'Failed to fetch fruits from server'
      );

      setFruitCatalogue(data);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch fruits from server');
    } finally {
      setLoading(false);
    }
  };

  // Loads how many fruit units are saved in other customers' carts, used for the 'in other carts' label.
  const fetchCartInterest = async () => {
    try {
      const data = await apiRequest<CartInterest[]>(
        `${API_URL}/api/fruits/cart-interest`,
        { headers: getAuthHeaders(token) },
        'Failed to fetch cart interest'
      );

      if (!Array.isArray(data)) {
        throw new Error('Failed to fetch cart interest');
      }

      const interestByFruit = data.reduce<Record<string, number>>((acc, item) => {
        acc[item.fruitId] = Number(item.quantityInCarts) || 0;
        return acc;
      }, {});

      setCartInterest(interestByFruit);
    } catch (err) {
      console.error('Failed to fetch cart interest:', err);
    }
  };

  useEffect(() => {
    fetchFruitCatalogue();
  }, []);

  useEffect(() => {
    fetchCartInterest();

    const interval = window.setInterval(fetchCartInterest, APP_CONFIG.cartInterest.refreshIntervalMs);

    return () => window.clearInterval(interval);
  }, [token]);

  useEffect(() => {
    localStorage.setItem('fruitStore_cart', JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    setFruitCataloguePage(1);
  }, [fruitCatalogue.length]);

  useEffect(() => {
    if (loading || fruitCatalogue.length === 0 || cart.length === 0) return;

    const adjustment = reconcileCartWithCatalogue(cart, fruitCatalogue);

    if (!adjustment.changed) return;

    const notice = [
      'Your cart was updated because product details changed:',
      ...adjustment.messages
    ].join('\n');
    const signature = `${notice}|${JSON.stringify(adjustment.nextCart)}`;

    setCart(adjustment.nextCart);
    setCartAdjustmentMessage(notice);

    if (lastCartAdjustmentSignatureRef.current !== signature) {
      lastCartAdjustmentSignatureRef.current = signature;
      alert(notice);
    }
  }, [cart, fruitCatalogue, loading, setCart]);

  useEffect(() => {
    if (loading || !token) return;

    apiRequest(
      `${API_URL}/api/cart/sync`,
      {
        method: 'POST',
        headers: getAuthHeaders(token, true),
        body: JSON.stringify({ cart })
      },
      'Failed to synchronize cart'
    )
      .then(() => fetchCartInterest())
      .catch(err => console.error('Tab closed or update synchronization delay error:', err));
  }, [cart, token, loading]);

  if (loading) return <div className="loading-card">Loading the fruit store...</div>;
  if (error) return <div className="error-card">Error: {error}</div>;

  // Adds an item to the local cart array or updates quantity if it already exists
  // Central cart update function. All Add/Minus/Remove actions come here so cart rules are kept in one place.
  const updateCartItemQuantity = (fruitId: string, quantity: number) => {
    const fruit = fruitCatalogue.find((item) => item.id === fruitId);

    if (!fruit) return;

    const safeQuantity = Math.min(Math.max(quantity, 0), fruit.stock);

    setCart((prevCart) => {
      if (safeQuantity <= 0) {
        return prevCart.filter((item) => item.id !== fruitId);
      }

      const existingItem = prevCart.find((item) => item.id === fruitId);

      if (existingItem) {
        return prevCart.map((item) => {
          if (item.id === fruitId) {
            return {
              ...item,
              name: fruit.name,
              price: Number(fruit.price),
              quantity: safeQuantity
            };
          }

          return item;
        });
      }

      return [
        ...prevCart,
        {
          id: fruit.id,
          name: fruit.name,
          price: Number(fruit.price),
          quantity: safeQuantity
        }
      ];
    });
  };

  // Clears the whole cart and removes the saved cart from localStorage.
  // Clears the local customer cart completely.
  const removeAllFromCart = () => {
    setCart([]);
    localStorage.removeItem('fruitStore_cart');
  };

  // Reorders a previous order by checking current stock/prices, asking for confirmation, then submitting it again.
  // Converts a previous order's items back into a new order request, after customer confirmation.
  const reorder = async (items: OrderItem[]) => {
    if (!token) {
      alert('Please log in before re-ordering.');
      return;
    }

    const warningMessages: string[] = [];

    const reorderedCart: CartItem[] = items
      .map((orderItem) => {
        const currentFruit = fruitCatalogue.find(
          (fruit) => fruit.id === orderItem.fruitId
        );

        if (!currentFruit || currentFruit.stock <= 0) {
          warningMessages.push(
            `- ${orderItem.name} is no longer available and was removed from this re-order.`
          );
          return null;
        }

        const currentPrice = Number(currentFruit.price);
        const previousPrice = Number(orderItem.priceAtPurchase);
        const finalQuantity = Math.min(orderItem.quantity, currentFruit.stock);

        if (currentPrice !== previousPrice) {
          warningMessages.push(
            `- ${orderItem.name} price changed from $${previousPrice.toFixed(2)} to $${currentPrice.toFixed(2)}.`
          );
        }

        if (finalQuantity < orderItem.quantity) {
          warningMessages.push(
            `- ${orderItem.name} only has ${currentFruit.stock} in stock, so quantity changed from ${orderItem.quantity} to ${finalQuantity}.`
          );
        }

        return {
          id: currentFruit.id,
          name: currentFruit.name,
          price: currentPrice,
          quantity: finalQuantity
        };
      })
      .filter((item): item is CartItem => item !== null && item.quantity > 0);

    if (reorderedCart.length === 0) {
      alert('None of the items from this order are currently available.');
      return;
    }

    const totalAmount = reorderedCart.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    const orderSummary = reorderedCart
      .map(
        (item) =>
          `${item.name} x${item.quantity} - $${(item.price * item.quantity).toFixed(2)}`
      )
      .join('\n');

    const warningText =
      warningMessages.length > 0
        ? `Important: This re-order does not exactly match your previous order.\n${warningMessages.join('\n')}\n\n`
        : '';

    const confirmReorder = window.confirm(
      `${warningText}Confirm re-order?\n\n${orderSummary}\n\nTotal: $${totalAmount.toFixed(2)}`
    );

    if (!confirmReorder) {
      return;
    }

    try {
      await apiRequest(
        `${API_URL}/api/orders`,
        {
          method: 'POST',
          headers: getAuthHeaders(token, true),
          body: JSON.stringify({ items: reorderedCart })
        },
        'Failed to complete re-order'
      );

      setCart([]);
      localStorage.removeItem('fruitStore_cart');

      await fetchFruitCatalogue();
      await fetchCartInterest();

      setOrderHistoryRefreshTrigger((prev) => prev + 1);

      alert('Re-order checkout successful!');
    } catch (err: any) {
      alert(err.message || 'Failed to complete re-order');
    }
  };

  // Submits the cart items to the server to finalize the checkout pipeline
  // Submits the current cart to the backend as an order. The backend checks stock and updates the database.
  const checkoutCart = async () => {
    if (cart.length === 0) return;
  
    try {
      const latestFruitCatalogue = await apiRequest<Fruit[]>(
        `${API_URL}/api/fruits`,
        undefined,
        'Failed to refresh fruit catalogue before checkout'
      );

      setFruitCatalogue(latestFruitCatalogue);

      const adjustment = reconcileCartWithCatalogue(cart, latestFruitCatalogue);

      if (adjustment.changed) {
        const notice = [
          'Your cart was updated because product details changed:',
          ...adjustment.messages,
          '',
          'Please review the updated cart, then click Checkout again.'
        ].join('\n');

        setCart(adjustment.nextCart);
        setCartAdjustmentMessage(notice);
        alert(notice);
        return;
      }

      await apiRequest(
        `${API_URL}/api/orders`,
        {
          method: 'POST',
          headers: getAuthHeaders(token, true),
          body: JSON.stringify({ items: adjustment.nextCart }) // Send current cart selection to server
        },
        'Server failed to process the order checkout'
      );

      setCart([]) // Flush cart contents locally upon success
      localStorage.removeItem('fruitStore_cart');
      
      await fetchFruitCatalogue();
      await fetchCartInterest();

      setOrderHistoryRefreshTrigger((prev) => prev + 1);

      alert("Checkout successful!");
    } catch (err) {
      console.error("Checkout Error", err);
      alert(err instanceof Error ? err.message : "Failed to checkout");
    }
  };
  
  // Refreshes the customer page after the AI bot successfully checks out an order.
  const refreshAfterAgentCheckout = async () => {
    await fetchFruitCatalogue();
    await fetchCartInterest();
    setOrderHistoryRefreshTrigger((prev) => prev + 1);
  };
  
  const {
    safePage: safeFruitCataloguePage,
    paginatedItems: paginatedFruitCatalogue
  } = getPaginatedItems(fruitCatalogue, fruitCataloguePage, fruitCatalogueItemsPerPage);

  return (
    <main className="store-layout">
      <div className="store-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Fresh Fruit Catalogue</h2>
              <p className="panel-subtitle">
                Choose your fruits and adjust quantities before checkout.
              </p>
            </div>
          </div>

          <div className="fruit-grid">
            {paginatedFruitCatalogue.map((fruit: Fruit) => (
              <FruitCatalogueCard
                key={fruit.id}
                fruit={fruit}
                cart={cart}
                cartInterestCount={cartInterest[fruit.id] || 0}
                updateCartItemQuantity={updateCartItemQuantity}
              />
            ))}
          </div>

          <PaginationControls
            currentPage={safeFruitCataloguePage}
            totalItems={fruitCatalogue.length}
            itemsPerPage={fruitCatalogueItemsPerPage}
            onPageChange={setFruitCataloguePage}
          />
        </section>

        <div className="cart-sidebar">
          <CartSummary
            cart={cart}
            fruitCatalogue={fruitCatalogue}
            updateCartItemQuantity={updateCartItemQuantity}
            removeAllFromCart={removeAllFromCart}
            checkoutCart={checkoutCart}
          />
        </div>
      </div>

      {token && (
        <>
          <OrderHistory 
            onReorder={reorder}     
            refreshTrigger={orderHistoryRefreshTrigger}  
          />
          <FloatingCustomerChat
            cart={cart}
            setCart={setCart}
            onAfterAgentCheckout={refreshAfterAgentCheckout}
          />
        </>
      )}
    </main>
  );
}

//#endregion

//#region Login and register component

// Login/register screen.
// It sends credentials to the backend and lets App decide which page to show based on the returned role.
function LoginPage({ onLoginSuccess, loggedInUsername, onLogout }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Handles both login and registration form submissions. actionType decides which backend route to call.
  const handleAuthAction = async (e: React.FormEvent, actionType: 'register' | 'login') => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const endpoint = actionType === 'register' ? '/api/auth/register' : '/api/auth/login';

    try {
      const data = await apiRequest<any>(
        `${API_URL}${endpoint}`,
        {
          method: 'POST',
          headers: getAuthHeaders(null, true),
          body: JSON.stringify({ username, password })
        },
        'Authentication failed.'
      );

      if (!data) {
        throw new Error('Server returned an empty or invalid JSON response.');
      }

      if (actionType === 'register') {
        alert('Customer account registered successfully! You can now click Log In.');
        setPassword('');
        return;
      }

      if (!data.token || !data.user) {
        throw new Error('Login response missing token or user data');
      }

      onLoginSuccess(
        data.token,
        data.user.role,
        data.user.username || username,
        data.user.cart || []
      );
    } catch (err: any) {
      setError(err.message || 'Network error connection failed.');
    } finally {
      setLoading(false);
    }
  };

  if (loggedInUsername) {
    return (
      <section className="auth-card">
        <div className="auth-top">
          <div>
            <p className="auth-label">Signed in</p>
            <p className="auth-user">{loggedInUsername}</p>
          </div>

          <button
            type="button"
            className="secondary-button"
            onClick={onLogout}
          >
            Log Out
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="auth-card">
      <div className="auth-top">
        <div>
          <p className="auth-label">Welcome to the store</p>
          <h2>Login</h2>
          <p className="auth-hint">
            Customer accounts open the store page. Owner accounts open the owner dashboard.
          </p>
        </div>
      </div>

      {error && <p className="error-text">{error}</p>}

      <form className="auth-form">
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
          placeholder="Enter username"
        />

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder="Enter password"
        />

        <button
          type="button"
          disabled={loading}
          onClick={(e) => handleAuthAction(e, 'login')}
        >
          {loading ? 'Processing...' : 'Log In'}
        </button>

        <button
          type="button"
          className="secondary-button"
          disabled={loading}
          onClick={(e) => handleAuthAction(e, 'register')}
        >
          {loading ? 'Processing...' : 'Create Customer Account'}
        </button>
      </form>
    </section>
  );
}

//#endregion

//#region Main app router component

// Root component of the React app.
// It decides whether to show LoginPage, CustomerPage, or OwnerPage based on login state and role.
function App() {
  // State string tracking which router page view to actively return on screen
  const [currentView, setCurrentView] = useState<'customer' | 'owner'>(() => {
    const savedToken = localStorage.getItem('fruitStore_token');
    const savedRole = localStorage.getItem('fruitStore_role');
    return savedToken && savedRole === 'owner' ? 'owner' : 'customer';
  });

  const [cart, setCart] = useState<CartItem[]>(() => {
    const savedCart = localStorage.getItem('fruitStore_cart');

    if (!savedCart) return [];

    try {
      return JSON.parse(savedCart);
    } catch {
      return [];
    }
  });

  const [loggedInUsername, setLoggedInUsername] = useState<string | null>(() => {
    return localStorage.getItem('fruitStore_username');
  });

  useEffect(() => {
    localStorage.setItem('fruitStore_view', currentView);
  }, [currentView]);

  // Saves login details locally, chooses the correct role page, and merges/loads the cart after login.
  const handleLoginSuccess = (token: string, role: string, username: string, userDbCart: CartItem[]) => {
    if (!token || token === 'undefined') {
      console.error('Invalid token received:', token);
      setCurrentView('customer');
      return;
    }

    localStorage.setItem('fruitStore_token', token);
    localStorage.setItem('fruitStore_username', username);
    localStorage.setItem('fruitStore_role', role);
    setLoggedInUsername(username);

    if (role === 'owner') {
      localStorage.setItem('fruitStore_view', 'owner');
      setCurrentView('owner');
      return;
    } 

    if (role === 'customer') {
      const cartFromDb = Array.isArray(userDbCart) ? userDbCart : [];

      setCart(cartFromDb);
      localStorage.setItem('fruitStore_cart', JSON.stringify(cartFromDb));
      localStorage.setItem('fruitStore_view', 'customer');
      setCurrentView('customer');
      return;
    }

    localStorage.removeItem('fruitStore_view');
    setCurrentView('customer');
  };

  // Syncs the customer's cart to the backend before removing local login details.
  const handleLogout = async (finalCart: CartItem[]) => {
    const role = localStorage.getItem('fruitStore_role');
    const token = localStorage.getItem('fruitStore_token');

    if (token && role === 'customer') {
      try {
        await apiRequest(
          `${API_URL}/api/cart/sync`,
          {
            method: 'POST',
            headers: getAuthHeaders(token, true),
            body: JSON.stringify({ cart: finalCart })
          },
          'Failed to synchronize cart before logout'
        );
      } catch (e) {
        console.error("Final log logout sync save error: ", e);
      }
    }

    localStorage.removeItem('fruitStore_token');
    localStorage.removeItem('fruitStore_view');
    localStorage.removeItem('fruitStore_username');
    localStorage.removeItem('fruitStore_role');
    setLoggedInUsername(null);
    setCart(finalCart);
    localStorage.setItem('fruitStore_cart', JSON.stringify(finalCart));
    setCurrentView('customer');
  }

  if (currentView === 'owner') {
    return (
      <div className="app-shell">
        <header className="app-header">
          <h1>Fruit Store</h1>
          <p>
            A clean dark-themed fruit store dashboard for managing catalogue items,
            customer orders, and daily sales.
          </p>
        </header>

        <LoginPage
          onLoginSuccess={handleLoginSuccess}
          loggedInUsername={loggedInUsername}
          onLogout={() => handleLogout(cart)}
        />

        <OwnerPage />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>Fruit Store</h1>
        <p>
          Fresh fruits, simple ordering, and a smooth checkout experience.
        </p>
      </header>

      <LoginPage
        onLoginSuccess={handleLoginSuccess}
        loggedInUsername={loggedInUsername}
        onLogout={() => handleLogout(cart)}
      />

      <CustomerPage
        cart={cart}
        setCart={setCart}
      />
    </div>
  );
}

export default App

//#endregion