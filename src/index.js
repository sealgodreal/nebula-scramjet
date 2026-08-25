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
			/*
				res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
				res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
			*/
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
<style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { width: 100vw; height: 100vh; overflow: hidden; }
    #sj-frame { position: fixed; inset: 0; width: 100%; height: 100%; border: none; }
    #loading { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; font-family: sans-serif; background: #000; color: #fff; font-size: 1.5rem; letter-spacing: 0.05em; }
</style>
</head>
<body>
	<div id="loading">Loading... Please be patient.</div>
	<script src="/scram/scramjet.all.js"></script>
	<script src="/baremux/index.js"></script>
	<script>
		const { ScramjetController } = $scramjetLoadController();
		const scramjet = new ScramjetController({
			files: {
				wasm: "/scram/scramjet.wasm.wasm",
				all: "/scram/scramjet.all.js",
				sync: "/scram/scramjet.sync.js",
			},
		});
		scramjet.init();
		const connection = new BareMux.BareMuxConnection("/baremux/worker.js");
		async function init() {
			const loading = document.getElementById("loading");
			try {
				if (!navigator.serviceWorker) throw new Error("Hey! Your browser doesn't support Service workers. Please enable them to use this service.");
				await navigator.serviceWorker.register("/sw.js");
				await navigator.serviceWorker.ready;

				const wispUrl = (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/wisp/";
				if ((await connection.getTransport()) !== "/libcurl/index.mjs") {
					await connection.setTransport("/libcurl/index.mjs", [{ websocket: wispUrl }]);
				}

				const frame = scramjet.createFrame();
				frame.frame.id = "sj-frame";
				frame.frame.allow = "camera; microphone; display-capture; autoplay; clipboard-read; clipboard-write; web-share; xr-spatial-tracking; gamepad; geolocation";
				frame.frame.allowFullscreen = true;
				document.body.appendChild(frame.frame);
				loading.remove();
				frame.go(${JSON.stringify(url)});
			} catch (err) {
				loading.textContent = "Error: " + err.message;
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