# Fruit Store Web Application

## Public Web Application

The deployed web application can be accessed here:

```txt
https://fruit-store-six.vercel.app/
```

## GitHub Repository

The source code for this project can be found here:

```txt
https://github.com/YBTanJordan/FruitStorePublic
```

## Project Overview

This Fruit Store application is a three-tier web application built using:

* **Frontend:** React with TypeScript, using Vercel
* **Backend:** Node.js with Express and TypeScript, using Vercel
* **Database:** PostgreSQL, using Neon

The application allows customers to browse fruits, manage a shopping cart, submit orders, view order history, and interact with a store chat assistant. Store owners are able to manage fruit stock, view submitted orders, and track sales.

---

# Implemented User Stories

## Required User Stories

### 1. As a customer, I want to see a list of fruits that are available to buy, complete with stock and pricing information, so that I can decide which fruits I want to buy.

**Implemented:** Yes

**Description:**
Customers can view all available fruits in the Fruit Catalogue. Each fruit displays its name, price, and available stock quantity. This is available regardless of whether the customer is logged in.

---

### 2. As a customer, I want to keep track of the fruits and quantity that I have shortlisted, including the total amount I need to pay, so that I can adjust my purchasing decisions as I shop.

**Implemented:** Yes

**Description:**
Customers have access to a shortlist called the Cart, which displays the current shortlisted items, their quantities, and the total amount required to pay. This is available regardless of whether the customer is logged in.
Customers can add or remove fruits from the cart through the Fruit Catalogue or from the cart itself.
The cart also displays the subtotal for each fruit.

---

### 3. As a customer, I want to submit my order of the fruits I selected, so that I can complete my purchase when I am done shopping. Assume that payment is done separate from this POS application.

**Implemented:** Yes

**Description:**
Customers can submit their shortlisted cart fruits as an order through the checkout function. This is available regardless of whether the customer is logged in.
The application records the ordered fruits, quantities, date, and total amount, while payment is handled separately from this POS application.
After checkout, stock levels are updated and the cart is cleared

---

### 4. As an owner, I want to see the orders that my customers have submitted, so that I can fulfill their orders.

**Implemented:** Yes

**Description:**
Owners can log in and view submitted customer orders, including the ordered fruits, quantities, and total order amount.
This requires owner login, so as to support user story #15.

---

## Optional User Stories

### 5. As an owner, I want to see the total sales for each day and for each fruit, so that I can track the performance of my store.

**Implemented:** Yes

**Description:**
The owner dashboard displays sales information based on submitted orders.
Owners can view total sales by day and by fruit.

---

### 6. As an owner, I want to be able to add new fruits and amend my stock levels, so that I can keep my online store up to date.

**Implemented:** Yes

**Description:**
Owners can add new fruits and amend existing fruit details through the owner interface.
Owners can edit fruit names, prices, and stock levels, as well as remove fruits from the customer-facing store.
Removed fruits are marked as inactive instead of being deleted, so past order records remain valid. Order history prices also remain based on the price at the time of purchase.

---

### 7. As a customer, I want to be able to log in and see my order history, so that I can track my previous purchases.

**Implemented:** Yes

**Description:**
Customers can log in to their accounts and view their previous orders in the order history section.
The order history shows past purchases, including fruits ordered, quantities, and total amount.

---

### 8. As a customer, I want to be able to re-order a previous order, so that I can quickly purchase the same items again.

**Implemented:** Yes

**Description:**
Customers can re-order a previous purchase from their order history.
The application asks for confirmation before placing the repeated order.
Users are alerted if prices or stock levels have changed since the original order.

---

### 9. As a customer, I want to know how many people are currently considering buying a fruit, so that I can make a quick decision before the stock runs out.

**Implemented:** Yes

**Description:**
The application shows how many other customers currently have each fruit in their cart as "X in others carts".
The count is updated regularly through page functions and interval-based updates, meaning the count can refresh even without the user interacting with the page.
This count can exceed the current stock quantity because it is based on how many users are considering the fruit, not the amount of stock available.

---

### 10. As a customer, I want to be able to ask the store owner common questions about a fruit, so that I can make an informed decision about my purchase.

**Implemented:** Yes

**Description:**
Logged-in customers can use the chat interface to message the store owner and ask questions.
Any owner can respond to customer questions, and the application tracks which owner answered which customer’s question.
The same chat interface also includes an AI shopping bot for simple store questions and cart actions.

---

### 11. As a customer, I want to be able to use the app on my phone so I can shop on the go.

**Implemented:** Yes

**Description:**
The application is responsive and usable on mobile devices.
Customers can browse fruits, manage their cart, check out, and use the chat interface on their phone.

---

### 12. As a customer, I want my order shortlist to be saved so that I can continue shopping on my device later, even if I have not logged in.

**Implemented:** Yes

**Description:**
The cart is saved locally on the customer’s device when the customer is not logged in.
This allows guest customers to refresh the page or return later without losing their shortlist.
If the customer logs in and already has an existing cart saved to their account, the account cart will override the locally saved cart.
If the customer logs out with items still in their cart, those items will be used as the locally saved cart.

---

### 13. As a customer, after logging in, I want my order shortlist to be saved so that I can log in and continue shopping on another device later.

**Implemented:** Yes

**Description:**
Logged-in customers have their cart saved to their account.
This allows customers to log in on another device and continue shopping from their saved shortlist.

---

### 14. As an owner, I want to be able to serve millions of customers at the same time, so that I can scale my business.

**Implemented:** Partially

**Description:**
The application uses a three-tier architecture with a separate frontend, backend API server, and database.
The application is publicly hosted and can support multiple users at the same time.
This is marked as partially implemented because serving millions of customers would require further production scaling, such as load balancing, caching, and stress testing.

---

### 15. As an owner, I do not want my customers to be able to see the whole store's order history, amend my stocks, or perform any actions that should only be available for me.

**Implemented:** Yes

**Description:**
Customers cannot access owner-only features such as viewing all store orders, adding fruits, editing fruits, or amending stock.
The application uses login authentication and role-based access control.

---

### 16. As an owner, I want my customers' order submissions to be encrypted, so they cannot be intercepted by my competitors.

**Implemented:** Yes

**Description:**
The deployed application uses HTTPS.
This encrypts communication between the customer’s browser and the deployed application during order submission.

---

### 17. As a customer, I want the fruit store pages to load quickly at all times, so that I can browse and shop without delays.

**Implemented:** Yes

**Description:**
The application uses a lightweight React frontend and API-based data loading.
Data is fetched only when needed, helping the fruit catalogue, cart, and order pages load quickly.
Pagination is also used for longer lists, such as order history and owner order views, so the page does not need to render too many records at once.
The cart is also saved locally for guest users, reducing unnecessary repeated loading.

---

# Additional Implemented Features

## AI Shopping Bot

The application includes an AI-powered shopping bot that allows customers to ask simple store-related questions, add fruits to their cart, remove fruits from their cart, and request checkout assistance through a chat interface.

This improves the shopping experience by allowing customers to interact with the store using natural language instead of only using buttons.

---

## Owner Sales Graphs

The owner dashboard includes simple visual graphs to make sales performance easier to understand.

Owners can view a fruit quantity trend graph showing how many units of each fruit were ordered across the last 7 days.
Owners can also view a total sales trend graph showing daily sales revenue from completed customer orders.

---

## Soft Deletion and Fruit Editing

Owners can edit fruit details such as the fruit name, price, and stock level from the owner dashboard.

When an owner removes a fruit, the fruit is marked as inactive instead of being permanently deleted from the database.

This prevents removed fruits from appearing in the customer-facing catalogue while still preserving past order records accurately. This is useful because customers and owners can still view old orders without losing the fruit details from the time of purchase.

---

## Low Stock and Out-of-Stock Indicators

The fruit catalogue clearly shows when fruits are low in stock or out of stock.

Low-stock indicators help customers make faster purchase decisions, while out-of-stock indicators prevent customers from trying to add unavailable fruits to their cart.

---

## Reorder Confirmation with Stock and Price Change Alerts

Customers can reorder previous purchases from their order history, but the application asks for confirmation before placing the repeated order.

The application also alerts customers if the current fruit prices or available stock have changed since the original order.

This helps customers avoid accidentally submitting a repeated order with unexpected price or stock differences.

---

## Test Accounts

### Customer1:

Username: C1

Password: 123


### Customer2:

Username: C2

Password: 123


### Owner:

Username: O1

Password: 123

Note: Owner accounts are not publicly registerable. They are provisioned separately to protect owner-only functions such as stock management and order viewing.

---

## Local Setup

### Backend
cd backend

npm install

npm run dev


### Frontend
cd frontend

npm install

npm run dev

---

## Environment Variables

Backend requires:

- DATABASE_URL

- JWT_SECRET

- GEMINI_API_KEY

Frontend requires:

- VITE_API_URL