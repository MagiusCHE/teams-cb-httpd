const http = require("http");
const fs = require("fs")
const path = require("path")
console.log("Process invoked with args:", process.argv)
const host = process.argv?.[2] || '127.0.0.1';
const port = process.argv?.[3] || '5333';
const background_root = "backgrounds"

const cfg_path = path.resolve(path.join(background_root, "config.json"))

console.log("Reading config from:", cfg_path)
const backgrounds_cfg = JSON.parse(fs.readFileSync(cfg_path).toString())

const config_file_to_send = {
    videoBackgroundImages: []
}
backgrounds_cfg.videoBackgroundImages.forEach(i => {
    const tos = Object.assign({}, i)
    for (k in tos) {
        if (k.startsWith("$")) {
            delete tos[k]
        }
    }
    tos.src = path.join("/evergreen-assets/backgroundimages/", i.src.trimStart('/'))
    tos.thumb_src = path.join("/evergreen-assets/backgroundimages/", i.thumb_src.trimStart('/'))
    config_file_to_send.videoBackgroundImages.push(tos)
})

const requestListener = function(req, res) {
    try {
        let retstatus = 200

        // Add Access-Control-Allow-Origin header to allow cross-origin requests
        res.setHeader('Access-Control-Allow-Origin', '*');
        console.log("  - Requested:", req.method, req.url)
        if (req.url?.split('?')[0] == "/config.json") {
            if (req.method == "OPTIONS") {
                res.setHeader("Allow", "GET, OPTIONS")
                res.writeHead(200);
                res.end();
                return
            }
            let data = JSON.stringify(config_file_to_send)
            res.setHeader("Content-Type", "application/json")
            res.writeHead(200);
            console.log("  - Served:", data)
            res.end(data);
        } else {
            let file            
            backgrounds_cfg.videoBackgroundImages.forEach(i => {
                if (i.src == decodeURIComponent(req.url)) {
                    file = i['$src_localpath'] || path.join(background_root, i.src)
                } else if (i.thumb_src == req.url) {
                    file = i['$thumb_src_localpath'] || path.join(background_root, i.thumb_src)
                }
            })
            if (!file || !fs.existsSync(file)) {
                retstatus = 404
                res.writeHead(retstatus);
                console.log("  - Not found:", req.url)
                if (file)
                    console.log("  - Local path is:", file)
                res.end("Not found");
            } else {
                let data = fs.readFileSync(file)
                res.writeHead(200);
                console.log("  - Served:", file)
                res.end(data);
            }
        }

        console.log("%s > %s: %s %s", req.socket.remoteAddress, new Date().toISOString(), retstatus, req.method, req.url)
    } catch (err) {
        retstatus = 503
        console.log("%s > %s: %s %s", req.socket.remoteAddress, new Date().toISOString(), retstatus, req.method, req.url)
        console.error(err)
        try {
            res.writeHead(retstatus);
            res.end("Internal error: " + err.message);
        } catch (err2) {

        }
    }
};
const server = http.createServer(requestListener);
server.listen(parseInt(port, 10), host, () => {
    console.log(`Server is running on http://${host}:${port}`);
});