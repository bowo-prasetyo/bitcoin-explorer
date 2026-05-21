# bitcoin-explorer

Client-Side Bitcoin Explorer Browser App

A lightweight browser-native Bitcoin explorer built entirely with client-side JavaScript using Vue, Vue Router, IndexedDB, Chart.js, and public Bitcoin APIs.

The application runs fully in the browser and can be hosted statically on GitHub Pages without requiring any backend server.

---

## Live Demo

[Live Demo](https://bowo-prasetyo.github.io/bitcoin-explorer/?utm_source=chatgpt.com)

---

## GitHub Repository

[GitHub Repository](https://github.com/bowo-prasetyo/bitcoin-explorer/?utm_source=chatgpt.com)

---

# Features

## Blockchain Explorer

* Latest blockchain tip
* Block explorer
* Transaction explorer
* Address explorer
* Recent blocks overview
* Mempool monitoring
* Fee estimation viewer
* Fee histogram visualization

---

## Smart API Failover System

The explorer includes an advanced multi-node failover layer:

* Multiple public Bitcoin API nodes
* Automatic failover
* Timeout handling
* Health scoring
* Latency tracking
* Preferred node caching
* Background benchmarking

Supported public APIs include:

* Blockstream
* Mempool.space
* Additional compatible mirrors

---

## Smart Auto Refresh System

Adaptive refresh architecture designed for blockchain data:

* Visibility-aware refresh
* Automatic pause on hidden tabs
* Adaptive polling intervals
* IndexedDB-assisted refresh
* Smart cache expiration
* Reduced unnecessary API traffic

---

## IndexedDB Cache

The explorer stores selected blockchain data locally using IndexedDB for:

* Faster reloads
* Reduced API usage
* Offline-friendly behavior
* Cached refresh recovery

Cached data includes:

* Blocks
* Transactions
* Mempool state
* Fee estimates
* Recent blockchain states

---

## Charts and Visualization

Built using Chart.js:

* Fee histogram
* Mempool congestion visualization
* Real-time network state monitoring

---

## Browser-Only Architecture

The application is intentionally designed as:

* Fully client-side
* Static-host friendly
* No backend server
* No database server
* No Node.js runtime required in production

This allows deployment directly to:

* GitHub Pages
* Static hosting providers
* CDN hosting

---

# Technology Stack

## Frontend

* Vue.js (CDN)
* Vue Router
* Chart.js

## Storage

* IndexedDB

## Networking

* Fetch API
* Public Bitcoin REST APIs

---

# Current Blockchain States Displayed

## Blockchain Tip

* Latest block height
* Latest block hash
* Block timestamp

## Recent Blocks

* Height
* Transaction count
* Block size
* Block weight

## Mempool State

* Pending transaction count
* Queue virtual size (vBytes)
* Total pending fees
* Fee histogram

## Fee Estimation State

* Estimated sat/vB rates
* Multiple confirmation targets

---

# Project Goals

This project explores the idea that modern browsers can function as lightweight blockchain clients using:

* IndexedDB for storage
* REST APIs for blockchain access
* Smart caching and synchronization
* Visualization and monitoring tools

The application demonstrates how much blockchain infrastructure can now run entirely inside the browser without dedicated backend services.

---

# Future Ideas

Potential future enhancements:

* SPV verification
* Merkle proof verification
* WebRTC peer communication
* WebSocket live updates
* Transaction broadcasting
* Wallet integration
* Lightning Network monitoring
* Advanced mempool analytics
* Historical charts
* Progressive Web App (PWA) support

---

# License

MIT License

---

# Assisted By

[ChatGPT](https://chatgpt.com/)
