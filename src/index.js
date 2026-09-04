import { createServer } from "node:http";
import { fileURLToPath } from "url";
import { hostname } from "node:os";
import { server as wisp, logging } from "@mercuryworkshop/wisp-js/server";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";

import { scramjetPath } from "@mercuryworkshop/scramjet/path";
import { libcurlPath } from "@mercuryworkshop/libcurl-transport";
import { baremuxPath } from "@mercuryworkshop/bare-mux/node";

const publicPath = fileURLToPath(new URL("../public/", import.meta.url));

logging.set_level(logging.NONE);
Object.assign(wisp.options, {
	allow_udp_streams: false,
	hostname_blacklist: [/example\.com/],
	dns_servers: ["1.1.1.3", "1.0.0.3"],
});

const fastify = Fastify({
	serverFactory: (handler) => {
		return createServer()
			.on("request", (req, res) => {
				handler(req, res);
			})
			.on("upgrade", (req, socket, head) => {
				if (req.url.endsWith("/wisp/")) wisp.routeRequest(req, socket, head);
				else socket.end();
			});
	},
});

fastify.register(fastifyStatic, {
	root: publicPath,
	decorateReply: true,
});

fastify.register(fastifyStatic, {
	root: scramjetPath,
	prefix: "/scram/",
	decorateReply: false,
});

fastify.register(fastifyStatic, {
	root: libcurlPath,
	prefix: "/libcurl/",
	decorateReply: false,
});

fastify.register(fastifyStatic, {
	root: baremuxPath,
	prefix: "/baremux/",
	decorateReply: false,
});

fastify.get("/learn/study/*", (req, reply) => {
	const link = req.params["*"];

	let url;
	try {
		url = decodeURIComponent(link);
	} catch {
		url = link;
	}
	if (!/^https?:\/\//.test(url)) url = "https://" + url;

	return reply.type("text/html").send(`<!doctype html>
<html>
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1.0, shrink-to-fit=no" />
	<link id="favicon" rel="icon" href="/favicon.ico" />
	<style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		body { width: 100vw; height: 100vh; overflow: hidden; }
		#sj-frame { position: fixed; inset: 0; width: 100%; height: 100%; border: none; }

		#loading {
			position: fixed;
			inset: 0;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			font-family: sans-serif;
			background: #000;
			color: #fff;
			gap: 1.25rem;
			z-index: 99999;
		}
		#loading.hidden {
			display: none;
		}

		#status-text {
			font-size: 1.1rem;
			letter-spacing: 0.04em;
			color: rgba(255, 255, 255, 0.85);
		}
		#status-text.error {
			color: #f87171;
			max-width: 420px;
			text-align: center;
			line-height: 1.5;
			font-size: 0.95rem;
		}
	</style>
</head>
<body>
	<div id="loading">
		<span id="status-text">Initializing...</span>
	</div>

	<script src="/scram/scramjet.all.js"></script>
	<script src="/baremux/index.js"></script>
	<script>
		const loadingEl = document.getElementById("loading");
		const statusEl  = document.getElementById("status-text");

		function setStatus(msg, isError = false) {
			statusEl.textContent = msg;
			statusEl.className = isError ? "error" : "";
		}

		async function clearCachesAndSW() {
    		try {
        		if (navigator.serviceWorker) {
            		const regs = await navigator.serviceWorker.getRegistrations();
            		await Promise.all(regs.map(r => r.unregister()));
        		}
    		} catch (e) {
        		console.warn("SW unregister failed:", e);
    		}
    		try {
        		if (window.caches) {
            		const keys = await caches.keys();
            		await Promise.all(keys.map(k => caches.delete(k)));
        		}
    		} catch (e) {
        		console.warn("Cache clear failed:", e);
    		}
    		try {
        		if (indexedDB.databases) {
            		const dbs = await indexedDB.databases();
            		await Promise.all(dbs.map(db => new Promise((res, rej) => {
                		const req = indexedDB.deleteDatabase(db.name);
                		req.onsuccess = res;
                		req.onerror = rej;
                		req.onblocked = res;
            		})));
        		}
    		} catch (e) {
        		console.warn("IDB clear failed:", e);
    		}
		}

		function syncTitleAndFavicon(iframeEl) {
			let lastTitle   = "";
			let lastFavicon = "";
			const faviconEl = document.getElementById("favicon");

			function update() {
				let doc;
				try {
					doc = iframeEl.contentDocument;
					if (!doc || !doc.head) return;
				} catch { return; }

				const newTitle = doc.title;
				if (newTitle && newTitle !== lastTitle) {
					lastTitle = newTitle;
					document.title = newTitle;
				}
				const iconLink   = doc.querySelector('link[rel~="icon"], link[rel~="shortcut"]');
				const newFavicon = iconLink ? iconLink.href : "";
				if (newFavicon && newFavicon !== lastFavicon) {
					lastFavicon = newFavicon;
					faviconEl.href = newFavicon;
				}
			}

			const interval = setInterval(update, 500);
			iframeEl.addEventListener("load", () => {
				update();
				try {
					const doc = iframeEl.contentDocument;
					if (!doc || !doc.head) return;
					const observer = new MutationObserver(update);
					observer.observe(doc.head, { childList: true, subtree: true, characterData: true });
				} catch {}
			});
			return () => clearInterval(interval);
		}

		async function init() {
			setStatus("Initializing...");

			try {
				if (!navigator.serviceWorker) {
					throw new Error("Your browser does not support service workers.");
				}

				await clearCachesAndSW();

				setStatus("Registering service worker...");
				try {
					await navigator.serviceWorker.register("/sw.js");
					await navigator.serviceWorker.ready;
				} catch (e) {
					throw new Error("Failed to register service worker: " + e.message);
				}

				const { ScramjetController } = $scramjetLoadController();
				const scramjet = new ScramjetController({
					files: {
						wasm: "/scram/scramjet.wasm.wasm",
						all:  "/scram/scramjet.all.js",
						sync: "/scram/scramjet.sync.js",
					},
				});
				scramjet.init();

				const connection = new BareMux.BareMuxConnection("/baremux/worker.js");
				const wispUrl = (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/wisp/";
				if ((await connection.getTransport()) !== "/libcurl/index.mjs") {
					await connection.setTransport("/libcurl/index.mjs", [{ websocket: wispUrl }]);
				}

				setStatus("Launching...");
				await new Promise(r => setTimeout(r, 300));

				const frame = scramjet.createFrame();
				frame.frame.id = "sj-frame";
				frame.frame.allow = "camera; microphone; display-capture; autoplay; clipboard-read; clipboard-write; web-share; xr-spatial-tracking; gamepad; geolocation; accelerometer; ambient-light-sensor; battery; bluetooth; browsing-topics; compute-pressure; document-domain; encrypted-media; execution-while-not-rendered; execution-while-out-of-viewport; fullscreen; gyroscope; hid; identity-credentials-get; idle-detection; keyboard-map; local-fonts; magnetometer; midi; otp-credentials; payment; picture-in-picture; publickey-credentials-create; publickey-credentials-get; screen-wake-lock; serial; speaker-selection; storage-access; usb; window-management";
				frame.frame.allowFullscreen = true;
				document.body.appendChild(frame.frame);

				loadingEl.classList.add("hidden");

				let _lastHref = "";
				setInterval(() => {
					let currentHref = "";
					try {
						currentHref = frame.frame.contentWindow?.location?.href || "";
					} catch { return; }

					if (currentHref && currentHref !== _lastHref) {
						_lastHref = currentHref;

						let realUrl = currentHref;
						const scramjetMarker = "/scramjet/";
						const markerIndex = realUrl.indexOf(scramjetMarker);
						if (markerIndex !== -1) {
							realUrl = realUrl.slice(markerIndex + scramjetMarker.length);
							try { realUrl = decodeURIComponent(realUrl); } catch {}
							try { realUrl = decodeURIComponent(realUrl); } catch {}
						}
						history.replaceState(null, "", "/learn/study/" + realUrl);
					}
				}, 150);

				syncTitleAndFavicon(frame.frame);
				frame.go(${JSON.stringify(url)});

			} catch (err) {
				setStatus(err.message, true);
				console.error(err);
			}
		}

		init();
	</script>
</body>
</html>`);
});

fastify.setNotFoundHandler((res, reply) => {
	return reply.code(404).type("text/html").sendFile("404.html");
});

fastify.server.on("listening", () => {
	const address = fastify.server.address();

	console.log("Listening on:");
	console.log(`\thttp://localhost:${address.port}`);
	console.log(`\thttp://${hostname()}:${address.port}`);
	console.log(
		`\thttp://${
			address.family === "IPv6" ? `[${address.address}]` : address.address
		}:${address.port}`
	);
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function shutdown() {
	console.log("SIGTERM signal received: closing HTTP server");
	fastify.close();
	process.exit(0);
}

let port = parseInt(process.env.PORT || "");
if (isNaN(port)) port = 8080;

fastify.listen({
	port: port,
	host: "0.0.0.0",
});
