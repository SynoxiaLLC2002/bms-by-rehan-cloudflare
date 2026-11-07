# BMS by Rehan — Cloudflare edition

A content management system for fast content sites: block editor, SEO tools, menus, forms and a Claude connector. This edition runs entirely on Cloudflare: the admin and API on Workers, the database on D1, media on R2, and the public pages rendered by Astro and cached at the edge.

Version 2.0.2.

## What you need

- A Cloudflare account on the Workers Paid plan ($5 a month covers all your sites)
- Docker Desktop (the deploy script builds inside Docker)
- A Windows PC for `deploy.ps1`, or any machine with Docker for `deploy/deploy.sh`

## Put a site online

Follow **[START-HERE.txt](START-HERE.txt)**. In short:

```
powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -Site my-site
powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -Site my-site -Domain example.com
```

The script creates the database, media bucket and both Workers, then prints your admin address. It saves the site's secret keys in `sites/<site>.env` on your PC: keep that file private and never commit it.

## Updating a site

Pull the new version and run the same command again with the same `-Site`.

## License

All rights reserved. You may read this code; using, copying or redistributing it needs written permission from the author.
