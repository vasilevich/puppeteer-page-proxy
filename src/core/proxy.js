const got = require("got");
const CookieHandler = require("../lib/cookies");
const {setHeaders, setAgent} = require("../lib/options");
const type = require("../util/types");

// Responsible for applying proxy
const requestHandler = async (request, proxy, overrides = {}) => {
    // Reject non http(s) URI schemes
    if (!request.url().startsWith("http") && !request.url().startsWith("https")) {
        request.continue();
        return;
    }
    const cookieHandler = new CookieHandler(request);
    // Request options for GOT accounting for overrides
    const options = {
        cookieJar: await cookieHandler.getCookies(),
        method: overrides.method || request.method(),
        body: overrides.postData || request.postData(),
        headers: overrides.headers || setHeaders(request),
        agent: setAgent(proxy),
        responseType: "buffer",
        maxRedirects: 15,
        throwHttpErrors: false,
        ignoreInvalidCookies: true,
        followRedirect: false
    };
    try {
        const response = await got(overrides.url || request.url(), options);
        // Set cookies manually because "set-cookie" doesn't set all cookies (?)
        // Perhaps related to https://github.com/puppeteer/puppeteer/issues/5364
        const setCookieHeader = response.headers["set-cookie"];
        if (setCookieHeader) {
            await cookieHandler.setCookies(setCookieHeader);
            response.headers["set-cookie"] = undefined;
        }
        await request.respond({
            status: response.statusCode,
            headers: response.headers,
            body: response.body
        });
    } catch (error) {
        await request.abort();
    }
};

// For reassigning proxy of page
const removeRequestListener = (page, listenerName) => {
    if (page.customListenersMap123) {
        const listener = page.customListenersMap123[listenerName];
        if (listener) {
            page.removeListener("request", listener);
            delete page.customListenersMap123[listenerName];
        }
    }
};

const useProxyPer = {
    // Call this if request object passed
    HTTPRequest: async (request, data) => {
        let proxy, overrides;
        // Separate proxy and overrides
        if (type(data) === "object") {
            if (Object.keys(data).length !== 0) {
                proxy = data.proxy;
                delete data.proxy;
                overrides = data;
            }
        } else {
            proxy = data
        }
        // Skip request if proxy omitted
        if (proxy) {
            await requestHandler(request, proxy, overrides)
        } else {
            request.continue(overrides)
        }
    },

    // Call this if page object passed
    CDPPage: async (page, proxy) => {
        await page.setRequestInterception(true);
        const listener = "$ppp_requestListener";
        removeRequestListener(page, listener);
        const f = {
            [listener]: async (request) => {
                await requestHandler(request, proxy);
            }
        };
        if (proxy) {
            const l = f[listener];
            page.on("request", l)
            if (!page.customListenersMap123) {
                page.customListenersMap123 = {};
            }
            page.customListenersMap123[listener] = l;
        } else {
            await page.setRequestInterception(false)
        }
    }
}
Object.keys(useProxyPer).forEach(k => useProxyPer[k.toLowerCase()] = useProxyPer[k]);
// Main function
const useProxy = async (target, data) => {
    useProxyPer[target.constructor.name.toLowerCase()](target, data);
};

module.exports = useProxy;
