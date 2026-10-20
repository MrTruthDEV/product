const APP_ID = 'phone_framebook'

let phoneBridgeApi = null

async function applyPhoneTheme() {
    if (!phoneBridgeApi || typeof phoneBridgeApi.getThemeMode !== 'function') return
    const theme = await phoneBridgeApi.getThemeMode()
    const mode = theme && theme.mode === 'dark' ? 'dark' : 'light'
    document.documentElement.setAttribute('data-theme', mode)
}

window.addEventListener('load', function () {
    document.body.style.visibility = 'visible'
    document.body.style.display = 'block'
    if (!window.invokeNative) {
        document.body.style.backgroundColor = '#18191a'
    }
})

window.addEventListener('load', function () {
    const boot = async function () {
        await (window.__qsBridgeReady || Promise.resolve())
        if (!window.QSPhoneBridge || typeof window.QSPhoneBridge.create !== 'function') {
            return
        }
        const runtime = window.QSPhoneBridge.create({
            appId: APP_ID,
            targetWindow: window.parent,
            targetOrigin: '*',
            requestTimeoutMs: 7000,
        })
        phoneBridgeApi = runtime.api
        window.phoneBridgeApi = phoneBridgeApi
        window.phoneBridgeRuntime = runtime

        void applyPhoneTheme()

        runtime.bridge.onReady(async function () {
            await applyPhoneTheme()
        })

        runtime.bridge.onEvent(async function (eventName, payload) {
            if (eventName === 'phone.theme.changed') {
                const mode = payload && payload.mode === 'dark' ? 'dark' : 'light'
                document.documentElement.setAttribute('data-theme', mode)
                return
            }
            if (eventName === 'app:opened') {
                await applyPhoneTheme()
            }
        })
    }
    void boot().catch(function (err) {
        console.warn('[phone-framebook]', err && err.message ? err.message : String(err))
    })
})
