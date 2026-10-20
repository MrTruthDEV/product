/**
 * iFruit plugin bridge — include this with a single <script> tag in your
 * custom app's HTML:
 *
 *   <script src="https://cfx-nui-Herd_phone/bridge/herd-phone-bridge.js"></script>
 *
 * Exposes `window.HerdPhone` for talking to the phone shell that's hosting
 * your app in an iframe. This is intentionally separate from your own app's
 * NUI calls to YOUR OWN resource (fetch('https://your-resource/route', ...)
 * already works directly, no bridge needed — see docs/plugin_apps.md).
 *
 * Vanilla JS, no build step, works whether your own app is bundled or not.
 */
(function () {
    var SOURCE_FROM_APP = 'herd-phone-bridge';
    var SOURCE_FROM_HOST = 'herd-phone-host';

    var state = { theme: 'light', language: 'en', playerName: '', identifier: '', ready: false };
    var themeListeners = [];
    var languageListeners = [];
    var readyListeners = [];

    function post(type, payload) {
        if (window.parent) {
            window.parent.postMessage({ source: SOURCE_FROM_APP, type: type, payload: payload }, '*');
        }
    }

    window.addEventListener('message', function (event) {
        var msg = event.data;
        if (!msg || msg.source !== SOURCE_FROM_HOST) return;

        if (msg.type === 'init') {
            state.theme = msg.payload.theme;
            state.language = msg.payload.language;
            state.playerName = msg.payload.playerName;
            state.identifier = msg.payload.identifier;
            state.ready = true;
            readyListeners.forEach(function (cb) { try { cb(state); } catch (e) { /* listener's own error, not ours */ } });
            readyListeners.length = 0;
            return;
        }

        if (msg.type === 'theme') {
            state.theme = msg.payload.theme;
            themeListeners.forEach(function (cb) { try { cb(state.theme); } catch (e) { /* listener's own error, not ours */ } });
            return;
        }

        if (msg.type === 'language') {
            state.language = msg.payload.language;
            languageListeners.forEach(function (cb) { try { cb(state.language); } catch (e) { /* listener's own error, not ours */ } });
        }
    });

    window.HerdPhone = {
        /** Raise a home/lock-screen notification for this app (needs `notification: true`, the default, at registration). */
        pushNotification: function (notification) {
            post('pushNotification', notification);
        },
        get theme() { return state.theme; },
        get language() { return state.language; },
        get playerName() { return state.playerName; },
        /** Your app's own `identifier`, as registered via AddCustomApp. */
        get identifier() { return state.identifier; },
        /** Fires once with { theme, language, playerName, identifier } as soon as the host has sent them — call your setup code from here, not on script load. */
        onReady: function (cb) {
            if (state.ready) { cb(state); } else { readyListeners.push(cb); }
        },
        onThemeChange: function (cb) { themeListeners.push(cb); },
        onLanguageChange: function (cb) { languageListeners.push(cb); },
    };

    post('ready');
})();
