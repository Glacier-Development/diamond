# Diamond - High-Performance Interception Web Proxy

## Project Structure

```
diamond/
├── data/                    # Dynamic JSON data files
│   ├── games.json          # Games library (contributor-managed)
│   └── apps.json           # Apps library (contributor-managed)
├── public/                  # Frontend assets (served statically)
│   ├── css/
│   │   └── style.css       # Minimal, performant styles
│   ├── js/
│   │   ├── app.js          # Main application logic
│   │   ├── browser.js      # Browser/omnibox functionality
│   │   └── sw-register.js  # Service Worker registration
│   ├── index.html          # Main entry point
│   └── sw.js               # Service Worker (interception engine)
├── src/                     # Backend proxy logic
│   └── proxy.js            # Proxy middleware & URL rewriting
├── .gitignore              # Git ignore rules
├── package.json            # Node.js dependencies & scripts
├── server.js               # Express server entry point
└── README.md               # Documentation
```

## Key Design Decisions

1. **Vanilla JS**: No frameworks to minimize bundle size and maximize compatibility with low-end devices.
2. **Service Worker Interception**: All network requests are intercepted at the browser level for seamless proxying.
3. **JSON-Driven Content**: Games and apps are loaded dynamically from JSON files for easy community contributions.
4. **Lightweight Backend**: Express.js with minimal middleware for fast startup and low memory footprint.
5. **Security**: Input sanitization, CORS handling, and request validation built into the proxy layer.

## Deployment

Designed for instant deployment on Render, Railway, or any VPS:
- Respects `PORT` environment variable
- Standard `npm start` script
- Static asset serving with proper caching headers

## Runtime configuration

Set `ADMIN_PASSWORD` before deploying to replace the compatibility default
`DiamondAdmin2024!Secure`. Admin sessions are HTTP-only, same-site cookies and
expire after eight hours. The restart button deliberately returns an explanatory
response because restarts must be performed by the process manager (Docker,
systemd, etc.).

## Backend layout

- `server.js` only composes HTTP middleware and starts the process.
- `src/backend/proxy.js` owns URL decoding, streaming upstream requests, header
  filtering, and reusable HTTP/HTTPS keep-alive pools.
- `src/backend/admin.js` owns authenticated settings endpoints and serialized
  writes to `config/settings.json`.

The proxy intentionally streams response bodies instead of buffering them. Its
separate LIFO keep-alive pools reduce connection and TLS setup work for repeated
origins while bounding active and idle socket counts.
