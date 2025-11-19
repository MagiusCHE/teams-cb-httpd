const http = require("http");
const fs = require("fs")
const path = require("path")

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"]);

function stripExtension(value) {
    if (!value && value !== 0) {
        return "";
    }
    const str = String(value);
    const lastSlash = Math.max(str.lastIndexOf('/'), str.lastIndexOf('\\'));
    const lastDot = str.lastIndexOf('.')
    if (lastDot === -1 || (lastSlash !== -1 && lastDot < lastSlash)) {
        return str;
    }
    return str.substring(0, lastDot);
}

function sanitizeId(value) {
    if (!value && value !== 0) {
        return "";
    }
    return String(value)
        .replace(/[^A-Za-z0-9_]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function sanitizeName(value) {
    if (!value && value !== 0) {
        return "";
    }
    return String(value)
        .replace(/[\\/]+/g, " - ")
        .replace(/[^A-Za-z0-9_\-\s]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function ensureUniqueId(rawId, usedIds, fallback) {
    const base = sanitizeId(stripExtension(rawId)) || sanitizeId(stripExtension(fallback)) || "background";
    let candidate = base;
    let counter = 1;
    while (!candidate || usedIds.has(candidate)) {
        candidate = `${base}_${counter++}`;
    }
    usedIds.add(candidate);
    return candidate;
}

function normalizeServingPath(value) {
    if (!value && value !== 0) {
        return "";
    }
    let normalized = String(value).trim();
    if (!normalized) {
        return "";
    }
    normalized = normalized.replace(/\\/g, "/");
    if (!normalized.startsWith("/")) {
        normalized = `/${normalized}`;
    }
    normalized = normalized.replace(/\/+/g, "/");
    return normalized;
}

function collectImageFiles(dir, recurse) {
    const results = [];
    const stack = [dir];
    while (stack.length) {
        const current = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (err) {
            console.warn(`Unable to read directory ${current}: ${err.message}`);
            continue;
        }
        entries.forEach(entry => {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (recurse) {
                    stack.push(fullPath);
                }
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (IMAGE_EXTENSIONS.has(ext)) {
                    results.push(fullPath);
                }
            }
        });
    }
    return results;
}

function ensureBackgroundImagePath(value) {
    const normalized = normalizeServingPath(value);
    if (!normalized) {
        return "/backgroundimages";
    }
    if (normalized === "/backgroundimages" || normalized.startsWith("/backgroundimages/")) {
        return normalized;
    }
    const trimmed = normalized.replace(/^\/+/, "");
    return path.posix.join("/backgroundimages", trimmed);
}

function finalizeBlock(entry, usedIds) {
    const block = Object.assign({}, entry);
    const inferredExt = path.extname(block.$src_localpath || block.src || "").replace(/^\./, "");
    block.id = ensureUniqueId(block.id, usedIds, block.name || path.basename(block.src || block.$src_localpath || ""));
    const sanitizedName = sanitizeName(stripExtension(block.name) || block.id);
    block.name = sanitizedName || block.id;
    block.src = ensureBackgroundImagePath(block.src);
    if (!block.src) {
        const suffix = inferredExt ? `.${inferredExt}` : "";
        block.src = ensureBackgroundImagePath(`/${block.id}${suffix}`);
    }
    block.thumb_src = ensureBackgroundImagePath(block.thumb_src || block.src);
    block.filetype = block.filetype || inferredExt || "png";
    return block;
}

function generateBlocksFromScan(entry, usedIds) {
    const scanDir = entry.$scan_dir;
    const recurse = !!entry.$recurse;
    const useRelative = !!entry.$use_relative_path_as_filename_and_id;
    if (!scanDir) {
        return [];
    }
    let stat;
    try {
        stat = fs.statSync(scanDir);
    } catch (err) {
        console.warn(`scan_dir missing (${scanDir}): ${err.message}`);
        return [];
    }
    if (!stat.isDirectory()) {
        console.warn(`scan_dir is not a directory: ${scanDir}`);
        return [];
    }
    const files = collectImageFiles(scanDir, recurse).sort((a, b) => a.localeCompare(b));
    const generated = [];
    files.forEach(filePath => {
        const ext = path.extname(filePath);
        const relativePath = path.relative(scanDir, filePath).split(path.sep).join('/');
        const relativeWithoutExt = stripExtension(relativePath);
        const baseName = useRelative ? relativeWithoutExt : path.basename(filePath, ext);
        const template = {};
        Object.keys(entry).forEach(key => {
            if (key === "$scan_dir" || key === "$recurse" || key === "$use_relative_path_as_filename_and_id") {
                return;
            }
            template[key] = entry[key];
        });
        template.id = baseName;
        template.name = baseName;
        template.filetype = template.filetype || ext.replace(/^\./, "").toLowerCase();
        template.$src_localpath = filePath;
        template.$thumb_src_localpath = filePath;
        const preferredPath = useRelative ? relativePath : path.basename(filePath);
        const normalizedPreferred = preferredPath.split(path.sep).join('/');
        template.src = path.posix.join("/backgroundimages", normalizedPreferred);
        template.thumb_src = template.src;
        generated.push(finalizeBlock(template, usedIds));
    });
    return generated;
}

function buildVideoBackgrounds(rawEntries) {
    const usedIds = new Set();
    const result = [];
    rawEntries.forEach(entry => {
        if (entry.$scan_dir) {
            const generated = generateBlocksFromScan(entry, usedIds);
            result.push(...generated);
        } else {
            result.push(finalizeBlock(entry, usedIds));
        }
    });
    return result;
}
console.log("Process invoked with args:", process.argv)
const host = process.argv?.[2] || '127.0.0.1';
const port = process.argv?.[3] || '5333';
const background_root = "backgrounds"

function computeLocalPathFromSrc(srcValue) {
    if (!srcValue) {
        return null;
    }
    const normalized = srcValue.replace(/^\/+/, "");
    const prefix = "backgroundimages/";
    const relative = normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
    return path.join(background_root, relative);
}

const cfg_path = path.resolve(path.join(background_root, "config.json"))

console.log("Reading config from:", cfg_path)
const backgrounds_cfg = JSON.parse(fs.readFileSync(cfg_path).toString())
backgrounds_cfg.videoBackgroundImages = buildVideoBackgrounds(backgrounds_cfg.videoBackgroundImages || [])

console.log("Loaded", backgrounds_cfg.videoBackgroundImages.length, "background entries")

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
    tos.src = ensureBackgroundImagePath(i.src)
    tos.thumb_src = ensureBackgroundImagePath(i.thumb_src)
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
            const decodedUrl = decodeURIComponent(req.url);
            backgrounds_cfg.videoBackgroundImages.forEach(i => {
                if (i.src == decodedUrl) {
                    file = i['$src_localpath'] || computeLocalPathFromSrc(i.src)
                } else if (i.thumb_src == decodedUrl) {
                    file = i['$thumb_src_localpath'] || computeLocalPathFromSrc(i.thumb_src)
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
