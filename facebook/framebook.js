; (function ($) {
    'use strict'

    // ══════════════════════════════════════════════════════════
    // CONSTANTS
    // ══════════════════════════════════════════════════════════
    // Inside the phone iframe GetParentResourceName() is often the host
    // (smartphone). Callbacks live on this page's own resource.
    function resourceName() {
        var host = (window.location && window.location.hostname) || ''
        if (host.indexOf('cfx-nui-') === 0) return host.replace('cfx-nui-', '')
        if (typeof window.GetParentResourceName === 'function') return window.GetParentResourceName()
        return 'phone-framebook'
    }
    var RESOURCE_NAME = resourceName()

    var REACTIONS = {
        like: { emoji: '👍', label: 'Like', color: '#1877F2' },
        love: { emoji: '❤️', label: 'Love', color: '#f02849' },
        haha: { emoji: '😆', label: 'Haha', color: '#f7b928' },
        wow: { emoji: '😮', label: 'Wow', color: '#f7b928' },
        sad: { emoji: '😢', label: 'Sad', color: '#f7b928' },
        angry: { emoji: '😠', label: 'Angry', color: '#e9710f' },
    }

    var FEELINGS = [
        { emoji: '😊', text: 'happy' },
        { emoji: '😔', text: 'sad' },
        { emoji: '😍', text: 'in love' },
        { emoji: '😎', text: 'cool' },
        { emoji: '😴', text: 'tired' },
        { emoji: '🥳', text: 'celebrating' },
        { emoji: '😡', text: 'angry' },
        { emoji: '😇', text: 'blessed' },
        { emoji: '🤒', text: 'sick' },
        { emoji: '🤑', text: 'motivated' },
    ]

    var AVATAR_COLORS = [
        '#1877F2', '#e41e3f', '#00b2ff', '#36bd4f', '#ff7614',
        '#ac00c2', '#00d7c3', '#e94545', '#ff9500', '#8e44ad',
    ]

    // ══════════════════════════════════════════════════════════
    // STATE
    // ══════════════════════════════════════════════════════════
    var S = {
        me: null,
        posts: [],
        stories: [],
        friends: [],        // accepted friends
        requests: [],       // incoming pending requests
        sentReqs: [],       // outgoing pending request IDs
        following: [],
        notifs: [],
        convos: {},
        favPosts: [],
        knownUsers: [],     // everyone encountered (posts, requests, messages)
        myServerId: null,   // real FiveM server ID
        tab: 'home',
        profileUid: null,
        chatUid: null,
        postOptId: null,
        postCmtId: null,
        storyOptId: null,
        feedFilter: 'all',
        pendingFeeling: null,
        playerName: '',
        unreadNotifs: 0,
        unreadReqs: 0,
        _lastPollTime: 0,
        _onlineIds: {},     // map of {userId: true} for users currently registered on the server
    }

    // ══════════════════════════════════════════════════════════
    // LOCALE  (Config.Locale from config.lua via NUI callback)
    // ══════════════════════════════════════════════════════════
    var L = {}   // populated in boot()
    var CFG = {  // runtime config from config.lua, populated in boot()
        storyDurationHours: 24,
    }

    function t(key, fallback) {
        return L[key] || fallback || key
    }

    function storyLifeMs() {
        var h = Number(CFG.storyDurationHours)
        if (!isFinite(h) || h <= 0) h = 24
        return h * 3600000
    }

    // ══════════════════════════════════════════════════════════
    // PERSISTENCE  (multi-account)
    // ══════════════════════════════════════════════════════════
    function pn() { return S.playerName || 'guest' }
    function dirKey() { return 'fb_dir_' + pn() }
    function activeKey() { return 'fb_active_' + pn() }
    function accountKey(id) { return 'fb_' + pn() + '_' + id }
    // legacy single-slot key (pre-multi-account)
    function legacyKey() { return 'fb_' + pn() }

    function getDirectory() {
        try { return JSON.parse(localStorage.getItem(dirKey())) || [] } catch (e) { return [] }
    }

    function saveDirectory() {
        if (!S.me) return
        var dir = getDirectory()
        var idx = dir.findIndex(function (a) { return a.id === S.me.id })
        var entry = { id: S.me.id, name: S.me.name, username: S.me.username, avatarColor: S.me.avatarColor, avatar: S.me.avatar }
        if (idx >= 0) { dir[idx] = entry } else { dir.push(entry) }
        localStorage.setItem(dirKey(), JSON.stringify(dir))
    }

    function removeFromDirectory(id) {
        var dir = getDirectory().filter(function (a) { return a.id !== id })
        localStorage.setItem(dirKey(), JSON.stringify(dir))
    }

    // Migrate old single-slot save to new per-account format
    function migrateOldStorage() {
        var old = localStorage.getItem(legacyKey())
        if (!old) return
        try {
            var d = JSON.parse(old)
            if (d && d.me && d.me.id) {
                localStorage.setItem(accountKey(d.me.id), old)
                var dir = getDirectory()
                if (!dir.some(function (a) { return a.id === d.me.id })) {
                    dir.push({ id: d.me.id, name: d.me.name, username: d.me.username || '', avatarColor: d.me.avatarColor, avatar: d.me.avatar || null })
                    localStorage.setItem(dirKey(), JSON.stringify(dir))
                }
                if (!localStorage.getItem(activeKey())) {
                    localStorage.setItem(activeKey(), d.me.id)
                }
            }
        } catch (e) { }
        localStorage.removeItem(legacyKey())
    }

    function save() {
        if (!S.me) return
        try {
            localStorage.setItem(accountKey(S.me.id), JSON.stringify({
                me: S.me, posts: S.posts, stories: S.stories,
                friends: S.friends, requests: S.requests, sentReqs: S.sentReqs,
                following: S.following, notifs: S.notifs, convos: S.convos,
                favPosts: S.favPosts, knownUsers: S.knownUsers,
            }))
            saveDirectory()
            localStorage.setItem(activeKey(), S.me.id)
        } catch (e) { /* storage full */ }
    }

    function load() {
        migrateOldStorage()
        var activeId = localStorage.getItem(activeKey())
        if (!activeId) return
        try {
            var raw = localStorage.getItem(accountKey(activeId))
            if (!raw) return
            var d = JSON.parse(raw)
            Object.assign(S, d)
        } catch (e) { /* corrupted */ }
    }

    // ══════════════════════════════════════════════════════════
    // UTILITIES
    // ══════════════════════════════════════════════════════════
    function uid() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 5) }

    function avatarColor(str) {
        var h = 0
        for (var i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h)
        return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]
    }

    function initials(name) {
        return (name || '?').split(' ').map(function (n) { return n[0] || '' }).join('').toUpperCase().substr(0, 2) || '?'
    }

    function timeAgo(ts) {
        var d = Date.now() - ts
        var m = Math.floor(d / 60000)
        var h = Math.floor(d / 3600000)
        var dy = Math.floor(d / 86400000)
        if (m < 1) return 'Just now'
        if (m < 60) return m + 'm'
        if (h < 24) return h + 'h'
        if (dy < 7) return dy + 'd'
        return new Date(ts).toLocaleDateString()
    }

    function avatarHtml(user, sz) {
        sz = sz || 'md'
        if (!user) return initialsHtml('?', '#888', sz)
        if (user.avatar) {
            return '<img src="' + esc(user.avatar) + '" class="avatar avatar-' + sz + '" alt="">'
        }
        return initialsHtml(user.name, user.avatarColor || '#1877F2', sz)
    }

    function initialsHtml(name, color, sz) {
        return '<div class="avatar avatar-' + sz + ' avatar-initials" style="background:' + color + '">' + initials(name) + '</div>'
    }

    function esc(s) {
        return String(s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    }

    // ══════════════════════════════════════════════════════════
    // NUI HELPERS
    // ══════════════════════════════════════════════════════════
    function nuiFetch(endpoint, data) {
        var timer
        var timeout = new Promise(function (resolve) {
            timer = setTimeout(function () { resolve({ ok: false }) }, 4000)
        })
        var req = fetch('https://' + RESOURCE_NAME + '/' + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data || {}),
        }).then(function (r) { return r.json() }).catch(function () { return { ok: false } })
        return Promise.race([req, timeout]).then(function (result) {
            clearTimeout(timer)
            return result
        })
    }

    function showToast(title, text) {
        var api = window.phoneBridgeApi
        if (api && typeof api.showToastNotification === 'function') {
            api.showToastNotification({ title: title, text: text, closeTimeout: 2500 })
        }
    }

    async function pickPhoto() {
        var api = window.phoneBridgeApi
        if (!api || typeof api.pickGalleryMedia !== 'function') return null
        var result = await api.pickGalleryMedia({ mediaFilter: 'photos' })
        if (result && result.url) return result.url
        if (result && result.uri) return result.uri
        return null
    }

    async function takePhoto() {
        var api = window.phoneBridgeApi
        if (!api || typeof api.openPhoneApp !== 'function') return null
        try {
            await api.openPhoneApp('camera')
        } catch (e) {
            return null
        }
        return null
    }

    async function pickGif() {
        var api = window.phoneBridgeApi
        if (!api || typeof api.pickGif !== 'function') return null
        var result = await api.pickGif()
        if (result && result.url) return result.url
        return null
    }

    // ══════════════════════════════════════════════════════════
    // VIEWS / NAVIGATION
    // ══════════════════════════════════════════════════════════
    function showHeader(id) {
        $('[id^="hdr-"]').addClass('hidden')
        if (id) $('#hdr-' + id).removeClass('hidden')
    }

    function goTo(tab, opts) {
        opts = opts || {}
        S.tab = tab
        $('.tab-pane').addClass('hidden')

        switch (tab) {
            case 'home':
                showHeader('home')
                $('#tab-home').removeClass('hidden')
                renderStories()
                renderFeed('#posts-feed', S.posts)
                updateHomeAvatar()
                break

            case 'feeds':
                showHeader('feeds')
                $('#tab-feeds').removeClass('hidden')
                renderFeedsTab()
                break

            case 'notifs':
                showHeader('notifs')
                $('#tab-notifs').removeClass('hidden')
                S.unreadNotifs = 0
                updateBadges()
                renderNotifs()
                break

            case 'friends':
                showHeader('friends')
                $('#tab-friends').removeClass('hidden')
                S.unreadReqs = 0
                updateBadges()
                renderFriends()
                break

            case 'profile':
                showHeader('profile')
                S.profileUid = opts.uid || null
                var _pu = opts.uid ? findUser(opts.uid) : S.me
                var pname = (_pu && _pu.name) || 'Profile'
                $('#profile-header-name').text(pname)
                if (_pu && _pu.verified) {
                    $('#profile-header-name').append(' <i class="fas fa-check-circle fb-verified"></i>')
                }
                $('#tab-profile').removeClass('hidden')
                renderProfile(opts.uid)
                break

            case 'messages':
                showHeader('messages')
                $('#tab-messages').removeClass('hidden')
                renderChatList()
                break

            case 'convo':
                showHeader('convo')
                S.chatUid = opts.uid
                var cu = findUser(opts.uid) || {}
                // .data() caches its value on first read, so also update the cache
                // when we re-assign the attribute for a new conversation partner.
                $('#convo-hdr-name').text(cu.name || opts.uid).attr('data-view-profile', opts.uid).data('view-profile', opts.uid)
                $('#convo-hdr-avatar').html(avatarHtml(cu, 'sm'))
                updateConvoStatus(opts.uid)
                $('#tab-convo').removeClass('hidden')
                renderMessages(opts.uid)
                $('#convo-messages').scrollTop(99999)
                break
        }

        // Bottom nav active state
        $('.nav-item').removeClass('active')
        var navMap = { home: 'home', feeds: 'feeds', friends: 'friends', notifs: 'notifs', profile: 'profile', messages: 'profile' }
        $('[data-tab="' + (navMap[tab] || tab) + '"]').addClass('active')
    }

    // ══════════════════════════════════════════════════════════
    // AVATARS (helper elements)
    // ══════════════════════════════════════════════════════════
    function updateHomeAvatar() {
        $('#home-user-avatar').html(avatarHtml(S.me, 'md'))
    }

    function updateNavAvatar() {
        $('#nav-avatar').html(avatarHtml(S.me, 'sm'))
    }

    function updateConvoStatus(uid) {
        var $s = $('.convo-hdr-status')
        if (isOnline(uid)) {
            $s.text(t('online', 'Active now')).removeClass('offline').addClass('online')
        } else {
            $s.text(t('offline', 'Offline')).removeClass('online').addClass('offline')
        }
    }

    function updateBadges() {
        var fn = S.unreadReqs
        var nn = S.unreadNotifs
        $('#badge-friends').toggleClass('hidden', fn <= 0).text(fn > 9 ? '9+' : fn)
        $('#badge-notifs').toggleClass('hidden', nn <= 0).text(nn > 9 ? '9+' : nn)
    }

    function findUser(uid) {
        return S.friends.find(function (f) { return f.id === uid })
            || S.knownUsers.find(function (u) { return u.id === uid })
            || null
    }

    // Register a user we've encountered so they appear in search/recommendations.
    // `authoritative` = true when the data comes from the server-side registry
    // (registerProfile / refreshUserList). Authoritative data overrides whatever
    // is cached; non-authoritative data (legacy info from posts) only fills gaps.
    function saveKnownUser(user, authoritative) {
        if (!user || !user.id) return
        if (S.me && user.id === S.me.id) return
        var idx = -1
        for (var i = 0; i < S.knownUsers.length; i++) {
            if (S.knownUsers[i].id === user.id) { idx = i; break }
        }
        var old = (idx >= 0) ? S.knownUsers[idx] : {}
        var pick = function (a, b) { return authoritative ? (a != null && a !== '' ? a : b) : (b != null && b !== '' ? b : a) }
        var merged = {
            id: user.id,
            name: pick(user.name, old.name) || 'Unknown',
            username: pick(user.username, old.username) || '',
            bio: pick(user.bio, old.bio) || '',
            avatar: pick(user.avatar, old.avatar) || null,
            avatarColor: pick(user.avatarColor, old.avatarColor) || avatarColor(user.name || old.name || 'Unknown'),
            serverId: pick(user.serverId, old.serverId) || null,
            verified: pick(user.verified, old.verified) || false,
            friendsCount: (authoritative && user.friendsCount != null)
                ? user.friendsCount
                : (old.friendsCount != null ? old.friendsCount : (user.friendsCount || 0)),
        }
        if (idx >= 0) { S.knownUsers[idx] = merged } else { S.knownUsers.push(merged) }
        // Also update friends list if this person is a friend
        var fi = S.friends.findIndex(function (f) { return f.id === user.id })
        if (fi >= 0) S.friends[fi] = Object.assign({}, S.friends[fi], merged)
        // When we get authoritative data, propagate the latest name/avatar
        // into stored posts/notifs so stale identifiers don't resurface later.
        if (authoritative) propagateUserUpdate(merged)
    }

    // Push fresh user info (name/username/avatar) into every place that
    // snapshots it, so renames are visible after a relog.
    function propagateUserUpdate(u) {
        if (!u || !u.id) return
        S.posts.forEach(function (p) {
            if (p.authorId === u.id) {
                p.authorName = u.name
                p.authorUsername = u.username
                p.authorAvatar = u.avatar
                p.authorServerId = u.serverId
            }
            if (p.comments && p.comments.length) {
                p.comments.forEach(function (c) {
                    if (c.authorId === u.id) c.authorName = u.name
                })
            }
        })
        S.notifs.forEach(function (n) {
            if (n.actorId === u.id) n.actorName = u.name
        })
        S.requests.forEach(function (r, i) {
            if (r.id === u.id) S.requests[i] = Object.assign({}, r, u)
        })
    }

    // Remove every trace of a user (account deletion).
    function purgeUser(userId) {
        if (!userId) return
        if (S.me && S.me.id === userId) return  // never purge self via remote event
        S.friends = S.friends.filter(function (f) { return f.id !== userId })
        S.knownUsers = S.knownUsers.filter(function (u) { return u.id !== userId })
        S.requests = S.requests.filter(function (r) { return r.id !== userId })
        S.sentReqs = S.sentReqs.filter(function (id) { return id !== userId })
        S.following = S.following.filter(function (id) { return id !== userId })
        S.posts = S.posts.filter(function (p) { return p.authorId !== userId })
        S.stories = S.stories.filter(function (s) { return s.authorId !== userId })
        S.notifs = S.notifs.filter(function (n) { return n.actorId !== userId })
        if (S.convos[userId]) delete S.convos[userId]
        delete S._onlineIds[userId]
    }

    function isOnline(userId) {
        if (!userId) return false
        if (S.me && userId === S.me.id) return true
        return S._onlineIds[userId] === true
    }

    // Populate knownUsers from posts we already have stored. This is
    // non-authoritative: it only fills gaps, never overrides fresh server data.
    function populateKnownUsersFromPosts() {
        S.posts.forEach(function (p) {
            if (!S.me || p.authorId === S.me.id) return
            saveKnownUser({
                id: p.authorId,
                name: p.authorName || 'Unknown',
                username: p.authorUsername || '',
                avatar: p.authorAvatar || null,
                avatarColor: avatarColor(p.authorName || 'Unknown'),
                serverId: p.authorServerId || null,
            }, false)
        })
    }

    // Merge friends + knownUsers (friends take priority) excluding self
    function allKnownPeople() {
        var seen = {}
        var result = []
        S.friends.forEach(function (u) { seen[u.id] = true; result.push(u) })
        S.knownUsers.forEach(function (u) { if (!seen[u.id]) { seen[u.id] = true; result.push(u) } })
        return result
    }

    // KnownUsers who are not yet friends and have no pending request
    function getRecommended() {
        return S.knownUsers.filter(function (u) {
            return !S.friends.some(function (f) { return f.id === u.id })
                && S.sentReqs.indexOf(u.id) === -1
                && !S.requests.some(function (r) { return r.id === u.id })
        })
    }

    // ══════════════════════════════════════════════════════════
    // STORIES RENDER
    // ══════════════════════════════════════════════════════════
    function hasActiveStories(authorId) {
        if (!authorId) return false
        var now = Date.now()
        var life = storyLifeMs()
        return S.stories.some(function (st) {
            return st.authorId === authorId && (now - st.ts) < life
        })
    }

    function renderStories() {
        var now = Date.now()
        var life = storyLifeMs()
        var alive = S.stories.filter(function (st) { return now - st.ts < life })
        S.stories = alive

        // Build create-story background from user avatar/cover
        var createBg = S.me && S.me.cover ? 'url(' + S.me.cover + ')' : ''
        $('#create-story-bg').css({ background: createBg || 'var(--fb-story-bg)', backgroundSize: 'cover', backgroundPosition: 'center' })

        // Remove old story cards, keep create card
        $('#stories-row .story-card:not(.create-story-card)').remove()

        // Deduplicate: one card per author (latest story wins)
        var byAuthor = {}
        alive.forEach(function (st) {
            if (!byAuthor[st.authorId] || st.ts > byAuthor[st.authorId].ts) {
                byAuthor[st.authorId] = st
            }
        })

        Object.keys(byAuthor).forEach(function (authorId) {
            var st = byAuthor[authorId]
            var author = authorId === (S.me && S.me.id)
                ? S.me
                : findUser(authorId)
            if (!author) return
            var isOwn = S.me && authorId === S.me.id
            var card = $(
                '<div class="story-card" data-story-id="' + esc(st.id) + '">' +
                '  <div class="story-card-bg"></div>' +
                '  <div class="story-card-overlay"></div>' +
                '  <div class="story-card-avatar">' + avatarHtml(author, 'sm') + '</div>' +
                (isOwn ? '  <button class="story-card-menu" data-story-options="' + esc(st.id) + '" title="' + esc(t('deleteStory', 'Delete Story')) + '"><i class="fas fa-ellipsis-h"></i></button>' : '') +
                '  <span class="story-card-label">' + esc(author.name) + '</span>' +
                '</div>'
            )
            if (st.image) {
                card.find('.story-card-bg').css({ backgroundImage: 'url(' + st.image + ')', backgroundSize: 'cover', backgroundPosition: 'center' })
            } else {
                card.find('.story-card-bg').css({ background: 'var(--fb-story-bg)' })
            }
            $('#stories-row').append(card)
        })
    }

    // ══════════════════════════════════════════════════════════
    // POSTS RENDER
    // ══════════════════════════════════════════════════════════
    function renderFeed(containerSel, posts) {
        var $c = $(containerSel)
        $c.empty()
        // Filter friends-only posts from non-friends
        var friendIds = S.friends.map(function (f) { return f.id })
        var visible = (posts || []).filter(function (p) {
            if (!p.privacy || p.privacy === 'everyone') return true
            if (p.authorId === (S.me && S.me.id)) return true
            return friendIds.indexOf(p.authorId) !== -1
        })
        var hasContent = visible.length > 0
        if (containerSel === '#posts-feed') {
            $('#feed-end').toggleClass('hidden', !hasContent)
        }
        if (!hasContent) {
            $c.html('<div class="empty-state"><i class="fas fa-stream"></i><p>' + t('noPosts', 'No posts yet. Be the first to post!') + '</p></div>')
            return
        }
        // newest first
        var sorted = visible.slice().sort(function (a, b) { return b.ts - a.ts })
        sorted.forEach(function (p) { $c.append(buildPostCard(p)) })
    }

    function buildPostCard(p) {
        var isOwn = S.me && p.authorId === S.me.id
        var author = isOwn ? S.me : (findUser(p.authorId) || { name: p.authorName || 'Unknown', id: p.authorId, avatarColor: '#888' })

        // Reaction summary
        var reactionKeys = Object.keys(p.reactions || {}).filter(function (k) { return (p.reactions[k] || []).length > 0 })
        var totalReacts = reactionKeys.reduce(function (sum, k) { return sum + (p.reactions[k] || []).length }, 0)
        var myReaction = getMyReaction(p)

        var reactionEmojisHtml = reactionKeys.slice(0, 3).map(function (k) {
            return '<span class="reaction-mini-emoji">' + REACTIONS[k].emoji + '</span>'
        }).join('')

        var likeLabel = myReaction ? REACTIONS[myReaction].label : 'Like'
        var likeColor = myReaction ? REACTIONS[myReaction].color : ''
        var likeClass = myReaction ? 'reacted-' + myReaction : ''
        var likeIcon = myReaction ? REACTIONS[myReaction].emoji : '<i class="far fa-thumbs-up"></i>'

        var isFav = S.favPosts.indexOf(p.id) !== -1

        var verifiedBadge = author.verified ? ' <i class="fas fa-check-circle fb-verified" title="Verified"></i>' : ''
        var privacyIcon = (p.privacy === 'friends')
            ? '<i class="fas fa-user-friends"></i>'
            : '<i class="fas fa-globe-americas"></i>'

        var html =
            '<div class="post-card" data-post-id="' + esc(p.id) + '">' +
            '  <div class="post-card-header">' +
            '    <div class="avatar avatar-md" style="flex-shrink:0;cursor:pointer" data-view-profile="' + esc(p.authorId) + '">' +
            avatarHtml(author, 'md') +
            '    </div>' +
            '    <div class="post-author-info">' +
            '      <span class="post-author-name" data-view-profile="' + esc(p.authorId) + '">' + esc(author.name) + verifiedBadge + '</span>' +
            '      <div class="post-author-meta">' + timeAgo(p.ts) + ' ' + privacyIcon + '</div>' +
            '    </div>' +
            '    <button class="post-options-btn" data-post-options="' + esc(p.id) + '" data-own="' + (isOwn ? '1' : '0') + '"><i class="fas fa-ellipsis-h"></i></button>' +
            '  </div>'

        if (p.feeling) {
            html += '<div class="post-feeling-tag">— is feeling ' + p.feeling + '</div>'
        }

        if (p.text) {
            var bigText = !p.image && p.text.length < 80
            html += '<div class="post-text' + (bigText ? ' post-text-large' : '') + '">' + esc(p.text) + '</div>'
        }

        if (p.image) {
            html += '<img class="post-img" src="' + esc(p.image) + '" alt="post image" data-post-id="' + esc(p.id) + '">'
        }

        html +=
            '  <div class="post-stats">' +
            '    <div class="post-reactions-summary" data-open-comments="' + esc(p.id) + '">' +
            (totalReacts > 0 ? '<span class="reaction-emojis-row">' + reactionEmojisHtml + '</span> <span>' + totalReacts + '</span>' : '') +
            '    </div>' +
            '    <div class="post-comments-count" data-open-comments="' + esc(p.id) + '">' +
            (p.comments && p.comments.length ? p.comments.length + ' comment' + (p.comments.length !== 1 ? 's' : '') : '') +
            '    </div>' +
            '  </div>' +
            '  <div class="post-actions">' +
            '    <button class="post-action-btn ' + likeClass + '" data-like-btn="' + esc(p.id) + '" data-long-like="' + esc(p.id) + '" style="' + (myReaction ? 'color:' + likeColor : '') + '">' +
            (typeof likeIcon === 'string' && likeIcon.startsWith('<') ? likeIcon : '<span style="margin-right:2px">' + likeIcon + '</span>') +
            ' <span>' + likeLabel + '</span>' +
            '    </button>' +
            '    <button class="post-action-btn" data-open-comments="' + esc(p.id) + '"><i class="far fa-comment"></i> ' + t('comment', 'Comment') + '</button>' +
            '    <button class="post-action-btn" data-share-post="' + esc(p.id) + '"><i class="fas fa-share"></i> ' + t('share', 'Share') + '</button>' +
            '  </div>' +
            '</div>'

        return html
    }

    function getMyReaction(p) {
        if (!S.me || !p.reactions) return null
        for (var k in p.reactions) {
            if ((p.reactions[k] || []).indexOf(S.me.id) !== -1) return k
        }
        return null
    }

    function getPost(pid) {
        return S.posts.find(function (p) { return p.id === pid }) || null
    }

    // ══════════════════════════════════════════════════════════
    // FEEDS TAB
    // ══════════════════════════════════════════════════════════
    function renderFeedsTab() {
        var filter = S.feedFilter
        var filtered
        if (filter === 'favorites') {
            filtered = S.posts.filter(function (p) { return S.favPosts.indexOf(p.id) !== -1 })
        } else if (filter === 'friends') {
            var friendIds = S.friends.map(function (f) { return f.id })
            filtered = S.posts.filter(function (p) { return friendIds.indexOf(p.authorId) !== -1 })
        } else {
            filtered = S.posts
        }
        renderFeed('#feeds-feed', filtered)
    }

    // ══════════════════════════════════════════════════════════
    // NOTIFICATIONS
    // ══════════════════════════════════════════════════════════
    function renderNotifs() {
        var $list = $('#notifs-list')
        $list.empty()
        if (!S.notifs || S.notifs.length === 0) {
            $('#notifs-empty').removeClass('hidden')
            return
        }
        $('#notifs-empty').addClass('hidden')
        var sorted = S.notifs.slice().sort(function (a, b) { return b.ts - a.ts })
        sorted.forEach(function (n) {
            var actor = findUser(n.actorId) || { name: n.actorName || 'Someone', avatarColor: '#888', id: n.actorId }
            var badge = n.reaction ? '<div class="notif-reaction-badge">' + (REACTIONS[n.reaction] ? REACTIONS[n.reaction].emoji : '🔔') + '</div>' : ''
            var actorId = esc(n.actorId || '')
            var html =
                '<div class="notif-item' + (n.read ? '' : ' unread') + '" data-notif-id="' + esc(n.id) + '" data-view-profile="' + actorId + '">' +
                '  <div class="notif-avatar-wrap" data-view-profile="' + actorId + '">' + avatarHtml(actor, 'lg') + badge + '</div>' +
                '  <div class="notif-text"><strong class="notif-actor-name" data-view-profile="' + actorId + '">' + esc(actor.name) + '</strong> ' + esc(n.text) +
                '    <span class="notif-time">' + timeAgo(n.ts) + '</span>' +
                '  </div>' +
                '</div>'
            $list.append(html)
            n.read = true
        })
        save()
    }

    function addNotif(actorId, actorName, text, reaction) {
        var n = { id: uid(), actorId: actorId, actorName: actorName, text: text, reaction: reaction || null, ts: Date.now(), read: false }
        S.notifs.unshift(n)
        if (S.notifs.length > 30) S.notifs = S.notifs.slice(0, 30)
        if (S.tab !== 'notifs') { S.unreadNotifs++; updateBadges() }
        save()
    }

    // ══════════════════════════════════════════════════════════
    // FRIENDS TAB
    // ══════════════════════════════════════════════════════════
    function renderFriends() {
        // Friend requests
        var $reqSection = $('#friend-requests-section')
        var $reqList = $('#friend-requests-list')
        $reqList.empty()
        if (S.requests.length > 0) {
            $reqSection.removeClass('hidden')
            S.requests.forEach(function (u) {
                $reqList.append(buildFriendCard(u, 'request'))
            })
        } else {
            $reqSection.addClass('hidden')
        }

        // People you may know = knownUsers not yet friends and no pending req
        var $discover = $('#discover-list')
        $discover.empty()
        var recommended = getRecommended()
        if (recommended.length > 0) {
            recommended.forEach(function (u) {
                $discover.append(buildFriendCard(u, 'discover'))
            })
        } else {
            $discover.html(
                '<div class="friend-card">' +
                '  <div class="avatar avatar-md avatar-initials" style="background:#1877F2;font-size:18px;display:flex;align-items:center;justify-content:center">🔍</div>' +
                '  <div class="friend-card-info">' +
                '    <span class="friend-card-name">No suggestions yet</span>' +
                '    <span class="friend-card-sub">Search to find people</span>' +
                '  </div>' +
                '  <div class="friend-card-actions">' +
                '    <button class="fb-btn fb-btn-primary fb-btn-sm" id="btn-open-add-friend"><i class="fas fa-search"></i> Search</button>' +
                '  </div>' +
                '</div>'
            )
        }

        // Friends list
        var $flist = $('#friends-list')
        var $fempty = $('#friends-empty')
        $flist.empty()
        $('#friends-count').text(S.friends.length)
        if (S.friends.length === 0) {
            $fempty.removeClass('hidden')
        } else {
            $fempty.addClass('hidden')
            S.friends.forEach(function (u) {
                $flist.append(buildFriendCard(u, 'friend'))
            })
        }
    }

    function buildFriendCard(u, type) {
        var actions = ''
        if (type === 'request') {
            actions =
                '<button class="fb-btn fb-btn-primary fb-btn-sm" data-accept-req="' + esc(u.id) + '">' + t('acceptFriend', 'Accept') + '</button>' +
                '<button class="fb-btn fb-btn-outline fb-btn-sm" data-decline-req="' + esc(u.id) + '">' + t('declineFriend', 'Decline') + '</button>'
        } else if (type === 'discover') {
            var isSent = S.sentReqs.indexOf(u.id) !== -1
            actions = isSent
                ? '<button class="fb-btn fb-btn-outline fb-btn-sm" disabled>' + t('friendRequestSent', 'Sent') + '</button>'
                : '<button class="fb-btn fb-btn-primary fb-btn-sm" data-send-req="' + esc(u.id) + '">' + t('addFriend', 'Add Friend') + '</button>'
        } else {
            actions =
                '<button class="fb-btn fb-btn-ghost fb-btn-sm" data-msg-friend="' + esc(u.id) + '">' + t('messageBtn', 'Message') + '</button>' +
                '<button class="fb-btn fb-btn-outline fb-btn-sm" data-unfriend="' + esc(u.id) + '">' + t('removeFriend', 'Unfriend') + '</button>'
        }
        return (
            '<div class="friend-card" data-view-profile="' + esc(u.id) + '">' +
            '  ' + avatarHtml(u, 'lg') +
            '  <div class="friend-card-info">' +
            '    <span class="friend-card-name">' + esc(u.name) + '</span>' +
            '    <span class="friend-card-sub">' + esc('@' + (u.username || u.id)) + '</span>' +
            '  </div>' +
            '  <div class="friend-card-actions">' + actions + '</div>' +
            '</div>'
        )
    }

    // ══════════════════════════════════════════════════════════
    // PROFILE VIEW
    // ══════════════════════════════════════════════════════════
    function renderProfile(uid) {
        var isOwn = !uid || uid === (S.me && S.me.id)
        var user = isOwn ? S.me : findUser(uid)
        if (!user) { $('#profile-view').html('<div class="empty-state"><i class="fas fa-user"></i><p>' + t('userNotFound', 'User not found') + '</p></div>'); return }

        var isFriend = !isOwn && S.friends.some(function (f) { return f.id === uid })
        var isSentReq = !isOwn && S.sentReqs.indexOf(uid) !== -1
        var hasIncomingReq = !isOwn && S.requests.some(function (r) { return r.id === uid })
        var isFollowing = !isOwn && S.following.indexOf(uid) !== -1

        var coverStyle = user.cover
            ? 'background-image:url(' + esc(user.cover) + ');background-size:cover;background-position:center'
            : ''

        var verifiedBadgeProfile = user.verified ? ' <i class="fas fa-check-circle fb-verified" title="Verified"></i>' : ''

        var actionBtns = ''
        if (isOwn) {
            actionBtns =
                '<button class="fb-btn fb-btn-ghost fb-btn-sm" id="btn-open-edit-profile"><i class="fas fa-pen"></i> ' + t('editProfile', 'Edit Profile') + '</button>' +
                '<button class="fb-btn fb-btn-outline fb-btn-sm" id="btn-open-profile-options"><i class="fas fa-ellipsis-h"></i></button>'
        } else {
            var followIcon = isFollowing ? '<i class="fas fa-bell-slash"></i>' : '<i class="fas fa-bell"></i>'
            var followBtn = '<button class="fb-btn fb-btn-ghost fb-btn-sm" data-toggle-follow="' + esc(uid) + '" title="' + (isFollowing ? t('unfollow', 'Unfollow') : t('follow', 'Follow')) + '">' + followIcon + '</button>'
            if (isFriend) {
                actionBtns =
                    '<button class="fb-btn fb-btn-ghost fb-btn-sm" data-msg-friend="' + esc(uid) + '"><i class="fab fa-facebook-messenger"></i> ' + t('messageBtn', 'Message') + '</button>' +
                    '<button class="fb-btn fb-btn-outline fb-btn-sm" data-unfriend="' + esc(uid) + '"><i class="fas fa-user-check"></i> ' + t('friends', 'Friends') + '</button>' +
                    followBtn
            } else if (isSentReq) {
                actionBtns = '<button class="fb-btn fb-btn-outline fb-btn-sm" disabled><i class="fas fa-user-clock"></i> ' + t('friendRequestSent', 'Requested') + '</button>' + followBtn
            } else if (hasIncomingReq) {
                actionBtns =
                    '<button class="fb-btn fb-btn-primary fb-btn-sm" data-accept-req="' + esc(uid) + '"><i class="fas fa-user-plus"></i> ' + t('acceptFriend', 'Accept') + '</button>' +
                    '<button class="fb-btn fb-btn-outline fb-btn-sm" data-decline-req="' + esc(uid) + '">' + t('declineFriend', 'Decline') + '</button>' +
                    followBtn
            } else {
                actionBtns = '<button class="fb-btn fb-btn-primary fb-btn-sm" data-add-friend="' + esc(uid) + '"><i class="fas fa-user-plus"></i> ' + t('addFriend', 'Add Friend') + '</button>' + followBtn
            }
        }

        var followersCount = 0
        var followingCount = 0
        var friendsCount = isOwn ? S.friends.length : (user.friendsCount || 0)

        var userPosts = S.posts.filter(function (p) { return p.authorId === user.id })

        var hasStories = hasActiveStories(user.id)
        var avatarClass = 'profile-avatar' + (hasStories ? ' has-stories' : '')
        var avatarAttrs = hasStories ? ' data-view-author-stories="' + esc(user.id) + '" style="cursor:pointer"' : ''
        var html =
            '<div class="profile-cover" style="' + coverStyle + '">' +
            (isOwn ? '<div class="profile-cover-edit" id="btn-edit-cover"><i class="fas fa-camera"></i> Edit Cover</div>' : '') +
            '</div>' +
            '<div class="profile-avatar-section">' +
            '  <div class="profile-avatar-wrap">' +
            '    <div class="' + avatarClass + '"' + avatarAttrs + '>' + avatarHtml(user, 'xl') + '</div>' +
            (isOwn ? '<button class="profile-avatar-edit-btn" id="btn-edit-avatar"><i class="fas fa-camera"></i></button>' : '') +
            '  </div>' +
            '  <div class="profile-action-btns">' + actionBtns + '</div>' +
            '</div>' +
            '<div class="profile-info">' +
            '  <span class="profile-name">' + esc(user.name) + verifiedBadgeProfile + '</span>' +
            '  <span class="profile-username">@' + esc(user.username || user.id) + '</span>' +
            (user.bio ? '<p class="profile-bio">' + esc(user.bio) + '</p>' : '') +
            '  <div class="profile-stats">' +
            '    <div class="profile-stat"><span class="profile-stat-num">' + friendsCount + '</span><span class="profile-stat-label">' + t('friends', 'Friends') + '</span></div>' +
            '    <div class="profile-stat"><span class="profile-stat-num">' + followersCount + '</span><span class="profile-stat-label">' + t('followers', 'Followers') + '</span></div>' +
            '    <div class="profile-stat"><span class="profile-stat-num">' + userPosts.length + '</span><span class="profile-stat-label">' + t('postsLabel', 'Posts') + '</span></div>' +
            '  </div>' +
            '</div>' +
            '<span class="profile-posts-title">' + t('postsLabel', 'Posts') + '</span>'

        $('#profile-view').html(html)

        if (userPosts.length === 0) {
            $('#profile-view').append('<div class="empty-state"><i class="fas fa-camera"></i><p>' + t('noPosts', 'No posts yet') + '</p></div>')
        } else {
            var sorted = userPosts.slice().sort(function (a, b) { return b.ts - a.ts })
            sorted.forEach(function (p) { $('#profile-view').append(buildPostCard(p)) })
        }
    }

    // ══════════════════════════════════════════════════════════
    // CHAT LIST
    // ══════════════════════════════════════════════════════════
    function renderChatList() {
        var $list = $('#chat-list')
        var $empty = $('#chats-empty')
        $list.empty()

        // Build a merged list: friends with conversations first, then friends without
        var withConvo = []
        var withoutConvo = []

        S.friends.forEach(function (u) {
            var convo = S.convos[u.id]
            if (convo && convo.messages && convo.messages.length > 0) {
                withConvo.push({ user: u, convo: convo })
            } else {
                withoutConvo.push({ user: u, convo: null })
            }
        })

        // Sort active conversations by last message time
        withConvo.sort(function (a, b) {
            var la = a.convo.messages[a.convo.messages.length - 1]
            var lb = b.convo.messages[b.convo.messages.length - 1]
            return (lb ? lb.ts : 0) - (la ? la.ts : 0)
        })

        var all = withConvo.concat(withoutConvo)

        if (all.length === 0) {
            $empty.removeClass('hidden')
            return
        }
        $empty.addClass('hidden')

        all.forEach(function (item) {
            var u = item.user
            var msgs = item.convo ? item.convo.messages : []
            var last = msgs[msgs.length - 1]
            var dotClass = 'chat-item-online-dot' + (isOnline(u.id) ? '' : ' offline')
            var html =
                '<div class="chat-item" data-open-convo="' + esc(u.id) + '">' +
                '  <div class="chat-item-avatar" data-view-profile="' + esc(u.id) + '">' + avatarHtml(u, 'lg') +
                '    <div class="' + dotClass + '"></div>' +
                '  </div>' +
                '  <div class="chat-item-info">' +
                '    <span class="chat-item-name" data-view-profile="' + esc(u.id) + '">' + esc(u.name) + '</span>' +
                '    <span class="chat-item-last">' + (last ? esc(last.text || '📷 Photo') : '<em style="color:var(--fb-text-3)">Say hello!</em>') + '</span>' +
                '  </div>' +
                '  <div class="chat-item-meta">' +
                '    <span class="chat-item-time">' + (last ? timeAgo(last.ts) : '') + '</span>' +
                '  </div>' +
                '</div>'
            $list.append(html)
        })
    }

    // ══════════════════════════════════════════════════════════
    // MESSAGES (conversation)
    // ══════════════════════════════════════════════════════════
    function renderMessages(uid) {
        var $c = $('#convo-messages')
        $c.empty()
        var convo = S.convos[uid]
        if (!convo || !convo.messages || convo.messages.length === 0) {
            $c.html('<div class="empty-state" style="padding:32px"><i class="fab fa-facebook-messenger"></i><p>No messages yet. Say hello!</p></div>')
            return
        }
        convo.messages.forEach(function (msg) {
            var isOut = msg.from === (S.me && S.me.id)
            var wrap = isOut ? 'outgoing' : 'incoming'
            var content = msg.image
                ? '<img class="msg-bubble-img" src="' + esc(msg.image) + '" alt="photo">'
                : esc(msg.text || '')
            var html =
                '<div class="msg-bubble-wrap ' + wrap + '">' +
                '  <div class="msg-bubble ' + wrap + '">' + content + '</div>' +
                '  <span class="msg-time">' + timeAgo(msg.ts) + '</span>' +
                '</div>'
            $c.append(html)
        })
        $c.scrollTop(99999)
    }

    function sendMessage(targetUid, text, image) {
        if (!text && !image) return
        if (!S.convos[targetUid]) S.convos[targetUid] = { messages: [] }
        var msg = { id: uid(), from: S.me.id, text: text || '', image: image || null, ts: Date.now() }
        S.convos[targetUid].messages.push(msg)
        save()
        renderMessages(targetUid)
        var target = findUser(targetUid)
        var targetServerId = (target && target.serverId) ? target.serverId : targetUid
        nuiFetch('framebook:sendMessage', { targetId: targetServerId, message: msg, fromUser: S.me })
    }

    // ══════════════════════════════════════════════════════════
    // CREATE POST
    // ══════════════════════════════════════════════════════════
    function openCreatePost() {
        $('#cp-avatar').html(avatarHtml(S.me, 'md'))
        $('#cp-name').text(S.me && S.me.name || '')
        $('#cp-text').val('')
        $('#cp-img').attr('src', '')
        $('#cp-img-preview').addClass('hidden')
        $('#cp-feeling-tag').addClass('hidden').text('')
        S.pendingFeeling = null
        S.pendingPrivacy = 'everyone'
        updatePrivacyBtn()
        openModal('create-post')
    }

    function updatePrivacyBtn() {
        var p = S.pendingPrivacy || 'everyone'
        var icon = p === 'friends' ? '<i class="fas fa-user-friends"></i>' : '<i class="fas fa-globe-americas"></i>'
        var label = p === 'friends' ? 'Friends' : 'Everyone'
        $('#btn-cp-privacy').html(icon + ' ' + label + ' <i class="fas fa-caret-down"></i>')
    }

    function openNewMessage() {
        var $list = $('#new-msg-list')
        var $empty = $('#new-msg-empty')
        $list.empty()
        if (S.friends.length === 0) {
            $empty.removeClass('hidden')
        } else {
            $empty.addClass('hidden')
            S.friends.forEach(function (u) {
                var html =
                    '<div class="new-msg-item" data-start-chat="' + esc(u.id) + '">' +
                    '  ' + avatarHtml(u, 'lg') +
                    '  <div class="new-msg-item-info">' +
                    '    <span class="new-msg-item-name">' + esc(u.name) + '</span>' +
                    '    <span class="new-msg-item-sub">@' + esc(u.username || u.id) + '</span>' +
                    '  </div>' +
                    '  <i class="fas fa-chevron-right" style="color:var(--fb-text-3)"></i>' +
                    '</div>'
                $list.append(html)
            })
        }
        openModal('new-message')
    }

    function publishPost() {
        var text = $('#cp-text').val().trim()
        var img = $('#cp-img').attr('src')
        if (!text && !img) { showToast(t('appName', 'Framebook'), t('postEmpty', 'Write something or add a photo!')); return }

        var post = {
            id: uid(),
            authorId: S.me.id,
            authorName: S.me.name,
            authorUsername: S.me.username || '',
            authorAvatar: S.me.avatar || null,
            authorServerId: S.myServerId || null,
            text: text,
            image: img || null,
            feeling: S.pendingFeeling || null,
            privacy: S.pendingPrivacy || 'everyone',
            reactions: {},
            comments: [],
            ts: Date.now(),
        }
        S.posts.unshift(post)
        save()
        closeModal('create-post')
        goTo('home')

        // Broadcast to other players
        nuiFetch('framebook:publishPost', { post: post })
    }

    // ══════════════════════════════════════════════════════════
    // REACTIONS
    // ══════════════════════════════════════════════════════════
    var reactionTimer = null
    var reactionTarget = null

    function showReactionPicker(postId, $btn) {
        reactionTarget = postId
        var pos = $btn.offset()
        var picker = $('#reactions-picker')
        picker.css({
            bottom: ($(window).height() - pos.top + 6) + 'px',
            left: Math.min(pos.left, $(window).width() - 260) + 'px',
        }).removeClass('hidden')
    }

    function hideReactionPicker() { $('#reactions-picker').addClass('hidden') }

    function applyReaction(postId, reaction) {
        var p = getPost(postId)
        if (!p) return
        var prev = getMyReaction(p)
        if (prev) {
            p.reactions[prev] = (p.reactions[prev] || []).filter(function (id) { return id !== S.me.id })
        }
        if (reaction !== prev) {
            if (!p.reactions[reaction]) p.reactions[reaction] = []
            p.reactions[reaction].push(S.me.id)
            // Notify the post AUTHOR (server-side push to them)
            if (p.authorId !== S.me.id) {
                var authorTarget = findUser(p.authorId)
                var authorServerId = (authorTarget && authorTarget.serverId) ? authorTarget.serverId : (p.authorServerId || p.authorId)
                nuiFetch('framebook:sendNotif', {
                    targetId: authorServerId,
                    notif: { id: uid(), actorId: S.me.id, actorName: S.me.name, text: 'reacted to your post', reaction: reaction, ts: Date.now(), read: false }
                })
            }
        }
        save()
        refreshPostCard(postId)
        // Broadcast updated post so others see the reaction
        nuiFetch('framebook:updatePost', { post: p })
    }

    function refreshPostCard(postId) {
        var $old = $('[data-post-id="' + postId + '"]')
        var p = getPost(postId)
        if (!p || !$old.length) return
        $old.replaceWith(buildPostCard(p))
    }

    // ══════════════════════════════════════════════════════════
    // COMMENTS
    // ══════════════════════════════════════════════════════════
    function openComments(postId) {
        S.postCmtId = postId
        var p = getPost(postId)
        if (!p) return
        var $scroll = $('#comments-scroll')
        $scroll.empty()
        $('#comment-avatar').html(avatarHtml(S.me, 'sm'))

        if (!p.comments || p.comments.length === 0) {
            $scroll.html('<div style="padding:24px;text-align:center;color:var(--fb-text-2);font-size:14px">' + t('noComments', 'No comments yet. Be the first!') + '</div>')
        } else {
            p.comments.forEach(function (c) {
                var cuser = c.authorId === (S.me && S.me.id) ? S.me : (findUser(c.authorId) || { name: c.authorName || 'Unknown', id: c.authorId, avatarColor: '#888' })
                var html =
                    '<div class="comment-item">' +
                    '  ' + avatarHtml(cuser, 'sm') +
                    '  <div class="comment-bubble">' +
                    '    <span class="comment-author" data-view-profile="' + esc(c.authorId) + '">' + esc(cuser.name) + '</span>' +
                    '    <span class="comment-text">' + esc(c.text) + '</span>' +
                    '    <span class="comment-time">' + timeAgo(c.ts) + '</span>' +
                    '  </div>' +
                    '</div>'
                $scroll.append(html)
            })
        }
        $('#comment-text-field').val('')
        openModal('comments')
        // Always start at the bottom so newest comments are visible
        setTimeout(function () {
            var el = document.getElementById('comments-scroll')
            if (el) el.scrollTop = el.scrollHeight
        }, 80)
    }

    function postComment() {
        var text = $('#comment-text-field').val().trim()
        if (!text || !S.postCmtId) return
        var p = getPost(S.postCmtId)
        if (!p) return
        var c = { id: uid(), authorId: S.me.id, authorName: S.me.name, text: text, ts: Date.now() }
        if (!p.comments) p.comments = []
        p.comments.push(c)
        save()
        // Notify the post AUTHOR (not ourselves)
        if (p.authorId !== S.me.id) {
            var authorTarget = findUser(p.authorId)
            var authorServerId = (authorTarget && authorTarget.serverId) ? authorTarget.serverId : (p.authorServerId || p.authorId)
            nuiFetch('framebook:sendNotif', {
                targetId: authorServerId,
                notif: { id: uid(), actorId: S.me.id, actorName: S.me.name, text: 'commented on your post', reaction: null, ts: Date.now(), read: false }
            })
        }
        openComments(S.postCmtId)
        refreshPostCard(S.postCmtId)
        // Broadcast updated post so others see the comment
        nuiFetch('framebook:updatePost', { post: p })
    }

    // ══════════════════════════════════════════════════════════
    // POST OPTIONS
    // ══════════════════════════════════════════════════════════
    function openPostOptions(postId, isOwn) {
        S.postOptId = postId
        var isFav = S.favPosts.indexOf(postId) !== -1
        $('#opt-fav-label').text(isFav ? t('removeFromFavorites', 'Remove from Favorites') : t('addToFavorites', 'Add to Favorites'))
        $('#opt-delete-post').toggleClass('hidden', !isOwn)
        openModal('post-options')
    }

    function toggleFavPost(postId) {
        var idx = S.favPosts.indexOf(postId)
        if (idx === -1) { S.favPosts.push(postId); showToast(t('appName', 'Framebook'), t('addedToFav', 'Added to Favorites!')) }
        else { S.favPosts.splice(idx, 1); showToast(t('appName', 'Framebook'), t('removedFromFav', 'Removed from Favorites')) }
        save()
    }

    function deletePost(postId) {
        S.posts = S.posts.filter(function (p) { return p.id !== postId })
        save()
        $('[data-post-id="' + postId + '"]').fadeOut(200, function () { $(this).remove() })
        showToast(t('appName', 'Framebook'), t('postDeleted', 'Post deleted'))
        nuiFetch('framebook:deletePost', { postId: postId })
    }

    function sharePost(postId) {
        showToast(t('appName', 'Framebook'), t('postShared', 'Post shared!'))
        if (S.me && S.me.id) {
            var p = getPost(postId)
            if (p && p.authorId !== S.me.id) addNotif(S.me.id, S.me.name, 'shared your post', null)
        }
    }

    // ══════════════════════════════════════════════════════════
    // FRIENDS ACTIONS
    // ══════════════════════════════════════════════════════════

    // Refresh search overlay in-place if it's currently visible
    function refreshSearchIfOpen() {
        if (!$('#search-overlay').hasClass('hidden')) {
            renderSearchResults($('#search-input').val().trim())
        }
    }

    function sendFriendRequest(userId) {
        if (S.friends.some(function (f) { return f.id === userId })) { showToast(t('appName', 'Framebook'), t('alreadyFriends', 'Already friends!')); return }
        // If they already sent us a request, accept it instead of creating a duplicate
        var incomingReq = S.requests.find(function (r) { return r.id === userId })
        if (incomingReq) {
            acceptRequest(userId)
            return
        }
        if (S.sentReqs.indexOf(userId) !== -1) { showToast(t('appName', 'Framebook'), t('requestAlreadySent', 'Request already sent!')); return }
        S.sentReqs.push(userId)
        save()
        var target = findUser(userId)
        var targetServerId = (target && target.serverId) ? target.serverId : null
        if (!targetServerId) {
            S.sentReqs = S.sentReqs.filter(function (id) { return id !== userId })
            save()
            showToast(t('appName', 'Framebook'), t('playerOffline', 'Player is not online right now'))
            return
        }
        nuiFetch('framebook:sendFriendRequest', { targetId: targetServerId, fromUser: S.me })
        showToast(t('appName', 'Framebook'), t('friendRequestSentToast', 'Friend request sent!'))
        renderFriends()
        refreshSearchIfOpen()
        if (S.tab === 'profile' && S.profileUid === userId) renderProfile(userId)
    }

    function acceptRequest(userId) {
        var u = S.requests.find(function (r) { return r.id === userId })
        if (!u) return
        S.requests = S.requests.filter(function (r) { return r.id !== userId })
        if (!S.friends.some(function (f) { return f.id === userId })) S.friends.push(u)
        save()
        var targetServerId = u.serverId || null
        nuiFetch('framebook:acceptFriendRequest', { targetId: targetServerId, fromUser: S.me })
        // Notify the requester (server push to them, not local notif to ourselves)
        if (targetServerId) {
            nuiFetch('framebook:sendNotif', {
                targetId: targetServerId,
                notif: { id: uid(), actorId: S.me.id, actorName: S.me.name, text: 'accepted your friend request', reaction: null, ts: Date.now(), read: false }
            })
        }
        showToast(t('appName', 'Framebook'), t('nowFriendsWith', 'Now friends with') + ' ' + u.name + '!')
        rebroadcastProfile()
        renderFriends()
        refreshSearchIfOpen()
        if (S.tab === 'profile' && S.profileUid === userId) renderProfile(userId)
    }

    function declineRequest(userId) {
        S.requests = S.requests.filter(function (r) { return r.id !== userId })
        save()
        renderFriends()
        refreshSearchIfOpen()
    }

    function unfriend(userId) {
        var u = S.friends.find(function (f) { return f.id === userId }) || findUser(userId)
        S.friends = S.friends.filter(function (f) { return f.id !== userId })
        save()
        if (u) {
            var targetServerId = u.serverId ? u.serverId : userId
            nuiFetch('framebook:unfriend', { targetId: targetServerId, fromUser: S.me })
        }
        rebroadcastProfile()
        if (S.tab === 'profile' && S.profileUid === userId) renderProfile(userId)
        renderFriends()
        refreshSearchIfOpen()
    }

    function toggleFollow(userId) {
        var idx = S.following.indexOf(userId)
        if (idx === -1) { S.following.push(userId); showToast(t('appName', 'Framebook'), t('followingToast', 'Following!')) }
        else { S.following.splice(idx, 1); showToast(t('appName', 'Framebook'), t('unfollowedToast', 'Unfollowed')) }
        save()
        renderProfile(S.profileUid || userId)
    }

    // ══════════════════════════════════════════════════════════
    // STORIES CREATE
    // ══════════════════════════════════════════════════════════
    function rebroadcastProfile() {
        if (!S.me) return
        S.me.friendsCount = S.friends.length
        save()
        nuiFetch('framebook:registerProfile', { profile: S.me })
    }

    function broadcastStory(story) {
        nuiFetch('framebook:publishStory', { story: story })
    }

    async function createStory() {
        var img = await pickPhoto()
        if (!img) return
        var story = { id: uid(), authorId: S.me.id, authorName: S.me.name, image: img, text: null, ts: Date.now() }
        S.stories.push(story)
        save()
        renderStories()
        broadcastStory(story)
        showToast(t('appName', 'Framebook'), t('storyAdded', 'Story added!'))
    }

    function viewStories(firstStoryId) {
        var first = S.stories.find(function (s) { return s.id === firstStoryId })
        if (!first) return
        var authorId = first.authorId
        // Collect all stories from this author sorted oldest→newest
        var queue = S.stories.filter(function (s) { return s.authorId === authorId }).sort(function (a, b) { return a.ts - b.ts })
        window._storyQueue = queue
        window._storyIndex = Math.max(0, queue.findIndex(function (s) { return s.id === firstStoryId }))
        // Build multi-segment progress bar
        var $bar = $('#story-prog-bar')
        $bar.empty()
        for (var si = 0; si < queue.length; si++) {
            $bar.append('<div class="story-prog-seg"><div class="story-prog-fill" data-idx="' + si + '"></div></div>')
        }
        openModal('story')
        _showStorySlide(window._storyIndex)
    }

    function _showStorySlide(idx) {
        clearTimeout(window._storyTimer)
        var queue = window._storyQueue || []
        if (idx < 0 || idx >= queue.length) { closeModal('story'); return }
        window._storyIndex = idx
        var st = queue[idx]
        var author = st.authorId === S.me.id ? S.me : (findUser(st.authorId) || { name: st.authorName, id: st.authorId, avatarColor: '#888' })
        $('#story-v-avatar').html(avatarHtml(author, 'sm'))
        $('#story-v-name').text(author.name)
        $('#story-v-time').text(timeAgo(st.ts))
        if (st.image) {
            $('#story-viewer-body').css({ backgroundImage: 'url(' + esc(st.image) + ')', backgroundSize: 'cover', backgroundPosition: 'center' })
        } else {
            $('#story-viewer-body').css({ backgroundImage: '', background: 'var(--fb-story-bg)' })
        }
        $('#story-viewer-text').text(st.text || '')
        // Reset all fills, mark previous as complete
        $('#story-prog-bar .story-prog-fill').css('transition', 'none').css('width', function () {
            return $(this).data('idx') < idx ? '100%' : '0%'
        })
        // Animate current fill
        var $cur = $('#story-prog-bar .story-prog-fill[data-idx="' + idx + '"]')
        setTimeout(function () { $cur.css('transition', 'width 6s linear').css('width', '100%') }, 50)
        // Auto-advance
        window._storyTimer = setTimeout(function () { _showStorySlide(idx + 1) }, 6000)
    }

    // ══════════════════════════════════════════════════════════
    // MODAL HELPERS
    // ══════════════════════════════════════════════════════════
    function openModal(name) { $('#modal-' + name).removeClass('hidden') }
    function closeModal(name) { $('#modal-' + name).addClass('hidden') }

    function openEditProfile() {
        if (!S.me) return
        $('#ep-name').val(S.me.name || '')
        $('#ep-username').val(S.me.username || '')
        $('#ep-bio').val(S.me.bio || '')
        if (S.me.cover) $('#ep-cover-preview').css({ backgroundImage: 'url(' + S.me.cover + ')', backgroundSize: 'cover', backgroundPosition: 'center' })
        $('#ep-avatar-preview').html(avatarHtml(S.me, 'xl'))
        openModal('edit-profile')
    }

    function saveProfile() {
        var name = $('#ep-name').val().trim()
        var username = $('#ep-username').val().trim().replace(/\s+/g, '_')
        var bio = $('#ep-bio').val().trim()
        if (!name) { showToast(t('appName', 'Framebook'), t('nameRequired', 'Name is required')); return }
        S.me.name = name
        S.me.username = username || S.me.username
        S.me.bio = bio
        save()
        closeModal('edit-profile')
        updateNavAvatar()
        renderProfile(null)
        showToast(t('appName', 'Framebook'), t('profileSaved', 'Profile saved!'))
        // Re-broadcast updated profile so other players see new name/username
        rebroadcastProfile()
    }

    function clearState() {
        S.me = null; S.posts = []; S.stories = []; S.friends = []; S.requests = []
        S.sentReqs = []; S.following = []; S.notifs = []; S.convos = {}
        S.favPosts = []; S.knownUsers = []; S.unreadNotifs = 0; S.unreadReqs = 0
        S._lastPollTime = 0
    }

    function showLoginView() {
        $('#view-app').addClass('hidden')
        $('#view-login').removeClass('hidden')
        // Show character name as placeholder example, not as pre-filled value
        if (S.playerName && S.playerName !== 'Player') {
            var exampleUser = S.playerName.toLowerCase().replace(/\s+/g, '_')
            $('#login-name').attr('placeholder', 'e.g., ' + S.playerName)
            $('#login-username').attr('placeholder', 'e.g., ' + exampleUser)
        }
        $('#login-name').val('')
        $('#login-username').val('')
        $('#login-bio').val('')
    }

    function logout() {
        save()
        localStorage.removeItem(activeKey())
        clearState()
        closeModal('profile-options')
        showLoginView()
        showToast(t('appName', 'Framebook'), t('loggedOut', 'Logged out'))
    }

    function deleteAccount() {
        if (!S.me) return
        var id = S.me.id
        // Tell the server so it can scrub the in-memory registry and notify
        // every other player to purge this user's posts, stories, etc.
        nuiFetch('framebook:deleteAccount', { userId: id })
        localStorage.removeItem(accountKey(id))
        removeFromDirectory(id)
        // If this was the active account, clear it
        if (localStorage.getItem(activeKey()) === id) localStorage.removeItem(activeKey())
        clearState()
        closeModal('profile-options')
        showLoginView()
        showToast(t('appName', 'Framebook'), t('accountDeleted', 'Account deleted'))
    }

    function deleteStory(storyId) {
        if (!storyId) return
        var st = S.stories.find(function (s) { return s.id === storyId })
        if (!st) return
        if (!S.me || st.authorId !== S.me.id) return  // only own stories
        S.stories = S.stories.filter(function (s) { return s.id !== storyId })
        save()
        renderStories()
        if (S.tab === 'profile') renderProfile(S.profileUid)
        nuiFetch('framebook:deleteStory', { storyId: storyId })
        showToast(t('appName', 'Framebook'), t('storyDeleted', 'Story deleted'))
    }

    function openRecover() {
        var dir = getDirectory()
        if (dir.length === 0) {
            $('#recover-accounts-list').empty()
            $('#recover-empty').removeClass('hidden')
        } else {
            $('#recover-empty').addClass('hidden')
            var html = dir.map(function (a) {
                return '<div class="recover-account-item" data-switch-account="' + esc(a.id) + '">' +
                    (a.avatar
                        ? '<img src="' + esc(a.avatar) + '" class="avatar avatar-md" alt="">'
                        : '<div class="avatar avatar-md avatar-initials" style="background:' + (a.avatarColor || '#888') + '">' + initials(a.name) + '</div>') +
                    '<div class="recover-account-info">' +
                    '  <span class="recover-account-name">' + esc(a.name) + '</span>' +
                    '  <span class="recover-account-user">@' + esc(a.username || a.id) + '</span>' +
                    '</div>' +
                    '<i class="fas fa-chevron-right recover-chevron"></i>' +
                    '</div>'
            }).join('')
            $('#recover-accounts-list').html(html)
        }
        openModal('recover')
    }

    function switchAccount(accountId) {
        var raw = localStorage.getItem(accountKey(accountId))
        if (!raw) { showToast('Framebook', 'Account data not found'); return }
        clearState()
        try {
            var d = JSON.parse(raw)
            Object.assign(S, d)
        } catch (e) { showToast('Framebook', 'Could not load account'); return }
        localStorage.setItem(activeKey(), accountId)
        if (S.me && S.myServerId) S.me.serverId = S.myServerId
        closeModal('recover')
        populateKnownUsersFromPosts()
        launchApp()
    }

    // ══════════════════════════════════════════════════════════
    // LOGIN
    // ══════════════════════════════════════════════════════════
    function createAccount() {
        var name = $('#login-name').val().trim()
        var username = $('#login-username').val().trim().replace(/\s+/g, '_').toLowerCase()
        var bio = $('#login-bio').val().trim()
        if (!name) { showToast(t('appName', 'Framebook'), t('nameRequired', 'Please enter your full name')); return }
        if (!username) { showToast(t('appName', 'Framebook'), t('usernameRequired', 'Please enter a username')); return }

        S.me = {
            id: uid(),
            name: name,
            username: username,
            bio: bio,
            avatar: null,
            cover: null,
            avatarColor: avatarColor(name),
            serverId: S.myServerId || null,
        }
        save()
        launchApp()
    }

    function launchApp() {
        $('#view-login').addClass('hidden')
        $('#view-app').removeClass('hidden')
        updateNavAvatar()
        updateBadges()
        goTo('home')
        // Announce own profile (with friend count), then pull the user list
        S.me.friendsCount = S.friends.length
        nuiFetch('framebook:registerProfile', { profile: S.me }).then(function () {
            setTimeout(refreshUserList, 800)
        })
    }

    function refreshUserList() {
        nuiFetch('framebook:getUsers').then(function (result) {
            if (!result || !Array.isArray(result.users)) return
            // Rebuild online ID set from the fresh server snapshot
            var onlineNow = {}
            result.users.forEach(function (u) {
                if (u && u.id) onlineNow[u.id] = true
            })
            var prevOnline = S._onlineIds
            S._onlineIds = onlineNow
            var changed = false
            result.users.forEach(function (u) {
                if (!S.me || u.id === S.me.id) return
                saveKnownUser(u, true)
                changed = true
                // Re-deliver pending friend requests to users who are now online
                if (S.sentReqs.indexOf(u.id) !== -1 && u.serverId) {
                    nuiFetch('framebook:sendFriendRequest', { targetId: u.serverId, fromUser: S.me })
                }
            })
            // Online status of the active convo partner may have changed
            if (S.tab === 'convo' && S.chatUid) {
                var wasOnline = prevOnline[S.chatUid] === true
                var isNowOnline = onlineNow[S.chatUid] === true
                if (wasOnline !== isNowOnline) updateConvoStatus(S.chatUid)
            }
            if (changed) {
                save()
                if (S.tab === 'home') renderFeed('#posts-feed', S.posts)
                if (S.tab === 'profile') renderProfile(S.profileUid)
                if (S.tab === 'friends') renderFriends()
                refreshSearchIfOpen()
            }
        })
    }

    function pollEvents() {
        if (!S.me) return
        nuiFetch('framebook:pollEvents', { since: S._lastPollTime }).then(function (result) {
            if (!result || !result.ok) return
            if (result.now) S._lastPollTime = result.now
            if (!result.events || result.events.length === 0) return
            var changed = false
            result.events.forEach(function (ev) {
                if (ev.type === 'friendRequest' && ev.data) {
                    var u = ev.data
                    saveKnownUser(u, true)
                    if (S.friends.some(function (f) { return f.id === u.id })) {
                        // already friends, ignore
                    } else if (S.sentReqs.indexOf(u.id) !== -1) {
                        // Mutual request — we already sent them one, auto-accept
                        S.sentReqs = S.sentReqs.filter(function (id) { return id !== u.id })
                        S.friends.push(u)
                        var muServerId = u.serverId || null
                        nuiFetch('framebook:acceptFriendRequest', { targetId: muServerId, fromUser: S.me })
                        if (muServerId) {
                            nuiFetch('framebook:sendNotif', {
                                targetId: muServerId,
                                notif: { id: uid(), actorId: S.me.id, actorName: S.me.name, text: 'accepted your friend request', reaction: null, ts: Date.now(), read: false }
                            })
                        }
                        showToast('Framebook', 'You and ' + u.name + ' are now friends!')
                        if (S.tab === 'friends') renderFriends()
                        refreshSearchIfOpen()
                        if (S.tab === 'profile' && S.profileUid === u.id) renderProfile(u.id)
                        changed = true
                    } else {
                        var alreadyReq = S.requests.some(function (r) { return r.id === u.id })
                        if (!alreadyReq) {
                            S.requests.push(u)
                            S.unreadReqs++
                            updateBadges()
                            showToast(u.name, 'Sent you a friend request!')
                            if (S.tab === 'friends') renderFriends()
                            refreshSearchIfOpen()
                            changed = true
                        }
                    }
                } else if (ev.type === 'friendAccepted' && ev.data) {
                    var u = ev.data
                    saveKnownUser(u, true)
                    S.sentReqs = S.sentReqs.filter(function (id) { return id !== u.id })
                    if (!S.friends.some(function (f) { return f.id === u.id })) {
                        S.friends.push(u)
                    }
                    showToast(u.name, 'Accepted your friend request!')
                    if (S.tab === 'friends') renderFriends()
                    refreshSearchIfOpen()
                    if (S.tab === 'profile' && S.profileUid === u.id) renderProfile(u.id)
                    changed = true
                } else if (ev.type === 'message' && ev.data) {
                    var fid = ev.data.from && ev.data.from.id
                    var msg = ev.data.message
                    if (fid && msg) {
                        saveKnownUser(ev.data.from, true)
                        if (!S.convos[fid]) S.convos[fid] = { messages: [] }
                        var dup = S.convos[fid].messages.some(function (m) { return m.id === msg.id })
                        if (!dup) {
                            S.convos[fid].messages.push(msg)
                            if (S.tab === 'convo' && S.chatUid === fid) renderMessages(fid)
                            else {
                                S.unreadNotifs++
                                updateBadges()
                                showToast(ev.data.from.name || 'Message', msg.text || 'Sent a photo')
                            }
                            changed = true
                        }
                    }
                } else if (ev.type === 'post' && ev.data) {
                    var post = ev.data
                    if (post.authorId !== (S.me && S.me.id)) {
                        saveKnownUser({
                            id: post.authorId,
                            name: post.authorName || 'Unknown',
                            username: post.authorUsername || '',
                            avatar: post.authorAvatar || null,
                            avatarColor: avatarColor(post.authorName || 'Unknown'),
                            serverId: post.authorServerId || null,
                        }, true)
                        var dup = S.posts.some(function (p) { return p.id === post.id })
                        if (!dup) {
                            S.posts.unshift(post)
                            if (S.posts.length > 50) S.posts = S.posts.slice(0, 50)
                            if (S.tab === 'home') renderFeed('#posts-feed', S.posts)
                            changed = true
                        }
                    }
                } else if (ev.type === 'postUpdate' && ev.data) {
                    var updatedPost = ev.data
                    var pidx = -1
                    for (var pi = 0; pi < S.posts.length; pi++) {
                        if (S.posts[pi].id === updatedPost.id) { pidx = pi; break }
                    }
                    if (pidx !== -1) {
                        var localPost = S.posts[pidx]
                        // Merge reactions: union of user ID arrays per reaction key
                        var mergedReactions = {}
                        var lr = localPost.reactions || {}
                        var ur = updatedPost.reactions || {}
                        var allRxKeys = Object.keys(lr).concat(Object.keys(ur).filter(function (k) { return !(k in lr) }))
                        allRxKeys.forEach(function (k) {
                            var merged = (lr[k] || []).slice()
                                ; (ur[k] || []).forEach(function (id) { if (merged.indexOf(id) === -1) merged.push(id) })
                            if (merged.length > 0) mergedReactions[k] = merged
                        })
                        // Merge comments: union by comment id, sorted by ts
                        var commentMap = {}
                            ; (localPost.comments || []).forEach(function (c) { commentMap[c.id] = c })
                            ; (updatedPost.comments || []).forEach(function (c) { commentMap[c.id] = c })
                        var mergedComments = Object.keys(commentMap).map(function (id) { return commentMap[id] }).sort(function (a, b) { return (a.ts || 0) - (b.ts || 0) })
                        S.posts[pidx] = Object.assign({}, updatedPost, { reactions: mergedReactions, comments: mergedComments })
                        refreshPostCard(updatedPost.id)
                        // If we're on home but card wasn't in DOM yet, force a re-render
                        if (S.tab === 'home' && !$('[data-post-id="' + updatedPost.id + '"]').length) {
                            renderFeed('#posts-feed', S.posts)
                        }
                        changed = true
                    } else {
                        // Post not found locally — add it (missed the original broadcast)
                        S.posts.unshift(updatedPost)
                        if (S.tab === 'home') renderFeed('#posts-feed', S.posts)
                        changed = true
                    }
                } else if (ev.type === 'notification' && ev.data) {
                    var inNotif = ev.data
                    var alreadyHave = S.notifs.some(function (n) { return n.id === inNotif.id })
                    if (!alreadyHave) {
                        S.notifs.unshift(inNotif)
                        if (S.notifs.length > 30) S.notifs = S.notifs.slice(0, 30)
                        S.unreadNotifs++
                        updateBadges()
                        showToast('Framebook', (inNotif.actorName || 'Someone') + ' ' + (inNotif.text || ''))
                        changed = true
                    }
                } else if (ev.type === 'story' && ev.data) {
                    var inStory = ev.data
                    if (inStory.authorId !== (S.me && S.me.id)) {
                        var storyDup = S.stories.some(function (s) { return s.id === inStory.id })
                        if (!storyDup) {
                            S.stories.push(inStory)
                            if (S.tab === 'home') renderStories()
                            changed = true
                        }
                    }
                } else if (ev.type === 'friendRemoved' && ev.data) {
                    var removedUser = ev.data
                    var wasFriend = S.friends.some(function (f) { return f.id === removedUser.id })
                    if (wasFriend) {
                        S.friends = S.friends.filter(function (f) { return f.id !== removedUser.id })
                        S.sentReqs = S.sentReqs.filter(function (id) { return id !== removedUser.id })
                        if (S.tab === 'friends') renderFriends()
                        if (S.tab === 'profile' && S.profileUid === removedUser.id) renderProfile(removedUser.id)
                        refreshSearchIfOpen()
                        changed = true
                    }
                } else if (ev.type === 'userVerified' && ev.data) {
                    var verifiedUser = ev.data
                    saveKnownUser(verifiedUser, true)
                    if (S.me && S.me.id === verifiedUser.id) S.me.verified = true
                    S.friends = S.friends.map(function (f) { return f.id === verifiedUser.id ? verifiedUser : f })
                    if (S.tab === 'home') renderFeed('#posts-feed', S.posts)
                    if (S.tab === 'profile') renderProfile(S.profileUid)
                    changed = true
                } else if (ev.type === 'postDeleted' && ev.data) {
                    var deletedId = ev.data
                    var hadIt = S.posts.some(function (p) { return p.id === deletedId })
                    if (hadIt) {
                        S.posts = S.posts.filter(function (p) { return p.id !== deletedId })
                        $('[data-post-id="' + deletedId + '"]').fadeOut(200, function () { $(this).remove() })
                        changed = true
                    }
                } else if (ev.type === 'userRegistered' && ev.data) {
                    saveKnownUser(ev.data, true)
                    if (ev.data && ev.data.id) S._onlineIds[ev.data.id] = true
                    if (S.tab === 'home') renderFeed('#posts-feed', S.posts)
                    if (S.tab === 'friends') renderFriends()
                    if (S.tab === 'convo' && S.chatUid === ev.data.id) updateConvoStatus(S.chatUid)
                    if (S.tab === 'profile' && S.profileUid === ev.data.id) renderProfile(ev.data.id)
                    refreshSearchIfOpen()
                    changed = true
                } else if (ev.type === 'storyDeleted' && ev.data) {
                    var sId = ev.data
                    var hadStory = S.stories.some(function (s) { return s.id === sId })
                    if (hadStory) {
                        S.stories = S.stories.filter(function (s) { return s.id !== sId })
                        if (S.tab === 'home') renderStories()
                        if (S.tab === 'profile') renderProfile(S.profileUid)
                        changed = true
                    }
                } else if (ev.type === 'accountDeleted' && ev.data) {
                    var goneId = ev.data
                    if (S.me && S.me.id === goneId) {
                        // Someone else broadcast the deletion of MY id — ignore
                    } else {
                        purgeUser(goneId)
                        if (S.tab === 'home') { renderStories(); renderFeed('#posts-feed', S.posts) }
                        if (S.tab === 'feeds') renderFeedsTab()
                        if (S.tab === 'friends') renderFriends()
                        if (S.tab === 'notifs') renderNotifs()
                        if (S.tab === 'messages') renderChatList()
                        if (S.tab === 'profile' && S.profileUid === goneId) goTo('home')
                        if (S.tab === 'convo' && S.chatUid === goneId) goTo('messages')
                        refreshSearchIfOpen()
                        changed = true
                    }
                }
            })
            if (changed) save()
        })
    }

    // Events are delivered via pollEvents() polling — no SendNUIMessage in this architecture

    // ══════════════════════════════════════════════════════════
    // SEARCH
    // ══════════════════════════════════════════════════════════
    function openSearch() {
        $('#search-overlay').removeClass('hidden')
        renderSearchResults('')
        setTimeout(function () { $('#search-input').focus() }, 120)
        // Fetch fresh user list immediately so newly registered players appear
        refreshUserList()
        setTimeout(function () {
            if ($('#search-overlay').hasClass('hidden')) return
            refreshUserList()
            var q = $('#search-input').val().trim()
            renderSearchResults(q)
        }, 1200)
    }

    function closeSearch() {
        $('#search-overlay').addClass('hidden')
        $('#search-input').val('')
        $('#btn-search-clear').addClass('hidden')
    }

    function personResultHtml(u, clickAction) {
        var isFriend = S.friends.some(function (f) { return f.id === u.id })
        var isSent = S.sentReqs.indexOf(u.id) !== -1
        var actionBtn = isFriend
            ? '<span class="fb-btn fb-btn-ghost fb-btn-sm" style="pointer-events:none"><i class="fas fa-user-check"></i> Friends</span>'
            : isSent
                ? '<button class="fb-btn fb-btn-outline fb-btn-sm" disabled>Sent</button>'
                : '<button class="fb-btn fb-btn-primary fb-btn-sm" data-send-req="' + esc(u.id) + '">Add</button>'
        return '<div class="search-result-item" ' + (clickAction || 'data-view-profile="' + esc(u.id) + '"') + '>' +
            avatarHtml(u, 'md') +
            '<div class="search-result-info">' +
            '  <span class="search-result-name">' + esc(u.name) + '</span>' +
            '  <span class="search-result-sub">@' + esc(u.username || u.id) + '</span>' +
            '</div>' +
            actionBtn +
            '</div>'
    }

    function renderSearchResults(q) {
        var $r = $('#search-results')
        var html = ''

        if (!q) {
            // Show recommendations — everyone we know who isn't a friend yet
            var rec = getRecommended()
            // Also always show friends so you can tap to view their profile
            if (rec.length === 0 && S.friends.length === 0) {
                $r.html('<div class="search-placeholder"><i class="fas fa-search"></i><p>Search for people or posts</p></div>')
                return
            }
            if (rec.length > 0) {
                html += '<div class="search-section-label">People you may know</div>'
                rec.forEach(function (u) { html += personResultHtml(u) })
            }
            if (S.friends.length > 0) {
                html += '<div class="search-section-label">Friends</div>'
                S.friends.forEach(function (u) { html += personResultHtml(u) })
            }
            $r.html(html)
            return
        }

        var ql = q.toLowerCase()

        // Search all encountered users (friends + knownUsers)
        var everyone = allKnownPeople()
        var matchedPeople = everyone.filter(function (u) {
            return u.name.toLowerCase().includes(ql)
                || (u.username || '').toLowerCase().includes(ql)
        })
        if (matchedPeople.length > 0) {
            html += '<div class="search-section-label">People</div>'
            matchedPeople.forEach(function (u) { html += personResultHtml(u) })
        }

        // Search posts by text or author name
        var matchedPosts = S.posts.filter(function (p) {
            return (p.text || '').toLowerCase().includes(ql)
                || (p.authorName || '').toLowerCase().includes(ql)
        }).slice(0, 6)
        if (matchedPosts.length > 0) {
            html += '<div class="search-section-label">Posts</div>'
            matchedPosts.forEach(function (p) {
                var author = (S.me && p.authorId === S.me.id) ? S.me
                    : (findUser(p.authorId) || { name: p.authorName || 'Unknown', avatarColor: '#888' })
                var preview = (p.text || '').substr(0, 55) + (p.text && p.text.length > 55 ? '…' : '')
                html +=
                    '<div class="search-result-item" data-open-comments="' + esc(p.id) + '" style="cursor:pointer">' +
                    avatarHtml(author, 'md') +
                    '<div class="search-result-info">' +
                    '  <span class="search-result-name">' + esc(author.name) + '</span>' +
                    '  <span class="search-result-sub">' + esc(preview || '📷 Photo') + '</span>' +
                    '</div>' +
                    '</div>'
            })
        }

        if (!html) {
            html = '<div class="search-placeholder"><i class="fas fa-search"></i><p>No results for "' + esc(q) + '"</p></div>'
        }
        $r.html(html)
    }

    // ══════════════════════════════════════════════════════════
    // EVENT BINDINGS (jQuery)
    // ══════════════════════════════════════════════════════════
    $(function () {

        // ── Login ──────────────────────────────────────────
        $(document).on('click', '#btn-create-account', createAccount)
        $(document).on('keydown', '#login-name, #login-username, #login-bio', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); createAccount() }
        })

        // ── Bottom Nav ─────────────────────────────────────
        $(document).on('click', '.nav-item[data-tab]', function () {
            var tab = $(this).data('tab')
            if (tab === 'profile') {
                goTo('profile', { uid: null })
            } else {
                goTo(tab)
            }
        })

        // ── Header buttons ─────────────────────────────────
        $(document).on('click', '#btn-hdr-messenger', function () { goTo('messages') })
        $(document).on('click', '#btn-new-message', function () { openNewMessage() })
        $(document).on('click', '[data-start-chat]', function () {
            closeModal('new-message')
            var fid = $(this).data('start-chat')
            var fu = findUser(fid) || {}
            goTo('convo', { uid: fid, userName: fu.name })
        })
        $(document).on('click', '#btn-hdr-search', function () { openSearch() })
        $(document).on('click', '#btn-feeds-search', function () { openSearch() })
        $(document).on('click', '#btn-friends-search', function () { openSearch() })
        $(document).on('click', '#btn-search-back', function () { closeSearch() })
        $(document).on('click', '#btn-search-clear', function () {
            $('#search-input').val('')
            $('#btn-search-clear').addClass('hidden')
            renderSearchResults('')
        })
        $(document).on('input', '#search-input', function () {
            var q = $(this).val().trim()
            $('#btn-search-clear').toggleClass('hidden', q.length === 0)
            renderSearchResults(q)
        })

        // ── Home feed shortcuts ─────────────────────────────
        $(document).on('click', '#btn-open-create-post, #btn-quick-photo, #btn-shortcut-photo, #btn-shortcut-feeling, #btn-shortcut-reel', function () {
            openCreatePost()
        })

        // ── Story ───────────────────────────────────────────
        $(document).on('click', '#btn-create-story', function () { createStory() })
        $(document).on('click', '.story-card:not(.create-story-card)', function () {
            viewStories($(this).data('story-id'))
        })
        $(document).on('click', '#story-tap-prev', function (e) {
            e.stopPropagation()
            _showStorySlide((window._storyIndex || 0) - 1)
        })
        $(document).on('click', '#story-tap-next', function (e) {
            e.stopPropagation()
            _showStorySlide((window._storyIndex || 0) + 1)
        })
        $(document).on('click', '#btn-close-story', function () {
            clearTimeout(window._storyTimer)
            closeModal('story')
        })

        // ── Create Post Modal ───────────────────────────────
        $(document).on('click', '[data-close-modal]', function () {
            closeModal($(this).data('close-modal'))
        })

        $(document).on('click', '#btn-cp-photo', async function () {
            var url = await pickPhoto()
            if (url) { $('#cp-img').attr('src', url); $('#cp-img-preview').removeClass('hidden') }
        })

        $(document).on('click', '#btn-cp-camera', async function () {
            var url = await takePhoto()
            if (url) { $('#cp-img').attr('src', url); $('#cp-img-preview').removeClass('hidden') }
        })

        $(document).on('click', '#btn-cp-gif', async function () {
            var url = await pickGif()
            if (url) { $('#cp-img').attr('src', url); $('#cp-img-preview').removeClass('hidden') }
        })

        $(document).on('click', '#btn-cp-feeling', function () { openModal('feelings') })

        $(document).on('click', '#btn-cp-privacy', function () {
            S.pendingPrivacy = (S.pendingPrivacy === 'friends') ? 'everyone' : 'friends'
            updatePrivacyBtn()
        })

        $(document).on('click', '#btn-cp-remove-img', function () {
            $('#cp-img').attr('src', '')
            $('#cp-img-preview').addClass('hidden')
        })

        $(document).on('click', '#btn-publish-post', publishPost)

        // ── Feelings ────────────────────────────────────────
        $(document).on('click', '.feeling-item', function () {
            var emoji = $(this).data('emoji')
            var text = $(this).data('text')
            S.pendingFeeling = emoji + ' ' + text
            $('#cp-feeling-tag').text('— is feeling ' + emoji + ' ' + text).removeClass('hidden')
            closeModal('feelings')
        })

        // ── Post options ────────────────────────────────────
        $(document).on('click', '[data-post-options]', function (e) {
            e.stopPropagation()
            openPostOptions($(this).data('post-options'), $(this).data('own') === '1' || $(this).data('own') === 1)
        })

        $(document).on('click', '#opt-fav-post', function () {
            if (S.postOptId) toggleFavPost(S.postOptId)
            closeModal('post-options')
        })

        $(document).on('click', '#opt-save-post', function () {
            if (S.postOptId) { toggleFavPost(S.postOptId) }
            closeModal('post-options')
        })

        $(document).on('click', '#opt-delete-post', function () {
            if (S.postOptId) deletePost(S.postOptId)
            closeModal('post-options')
        })

        // ── Reactions ───────────────────────────────────────
        var holdTimer = null

        $(document).on('mousedown touchstart', '[data-like-btn]', function (e) {
            var pid = $(this).data('like-btn')
            var $btn = $(this)
            holdTimer = setTimeout(function () {
                holdTimer = null
                showReactionPicker(pid, $btn)
            }, 500)
        })

        $(document).on('mouseup touchend', '[data-like-btn]', function (e) {
            if (holdTimer !== null) {
                clearTimeout(holdTimer)
                holdTimer = null
                // Short tap = toggle like
                var pid = $(this).data('like-btn')
                var p = getPost(pid)
                if (!p) return
                var cur = getMyReaction(p)
                applyReaction(pid, cur ? cur : 'like')
            }
        })

        $(document).on('click', '.reaction-opt', function () {
            var r = $(this).data('reaction')
            if (reactionTarget) applyReaction(reactionTarget, r)
            hideReactionPicker()
        })

        $(document).on('click', function (e) {
            if (!$(e.target).closest('#reactions-picker, [data-like-btn]').length) {
                hideReactionPicker()
            }
        })

        // ── Comments ────────────────────────────────────────
        $(document).on('click', '[data-open-comments]', function () {
            closeSearch()
            openComments($(this).data('open-comments'))
        })

        $(document).on('click', '#btn-post-comment', postComment)
        $(document).on('keydown', '#comment-text-field', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); postComment() }
        })

        // ── Share ────────────────────────────────────────────
        $(document).on('click', '[data-share-post]', function (e) {
            e.stopPropagation()
            sharePost($(this).data('share-post'))
        })

        // ── Feeds sub-tabs ──────────────────────────────────
        $(document).on('click', '.feeds-subtab', function () {
            $('.feeds-subtab').removeClass('active')
            $(this).addClass('active')
            S.feedFilter = $(this).data('filter')
            renderFeedsTab()
        })

        // ── View profile ────────────────────────────────────
        $(document).on('click', '[data-view-profile]', function (e) {
            // Don't navigate when clicking action buttons inside the card
            if ($(e.target).closest('.friend-card-actions, [data-send-req], [data-accept-req], [data-decline-req], [data-unfriend], [data-story-options], [data-view-author-stories]').length) return
            // Allow nested elements with their own data-view-profile to take precedence
            var $closest = $(e.target).closest('[data-view-profile]')
            if ($closest.length && $closest[0] !== this) return
            var uid = $(this).data('view-profile')
            if (!uid) return
            e.stopPropagation()
            closeSearch()
            goTo('profile', { uid: uid !== (S.me && S.me.id) ? uid : null })
        })

        // ── View author's stories (blue-ring profile avatar) ─
        $(document).on('click', '[data-view-author-stories]', function (e) {
            e.stopPropagation()
            var authorId = $(this).data('view-author-stories')
            var first = S.stories
                .filter(function (s) { return s.authorId === authorId })
                .sort(function (a, b) { return a.ts - b.ts })[0]
            if (first) viewStories(first.id)
        })

        // ── Double-click anywhere on a post → like ──────────
        $(document).on('dblclick', '.post-card', function (e) {
            // Ignore double-clicks on interactive children
            if ($(e.target).closest('button, [data-post-options], [data-share-post], [data-open-comments], [data-view-profile]').length) return
            e.preventDefault()
            var pid = $(this).data('post-id')
            if (!pid) return
            var p = getPost(pid)
            if (!p) return
            // If already reacted with anything, leave it; otherwise add a like
            if (!getMyReaction(p)) applyReaction(pid, 'like')
            // Subtle visual confirmation
            var $heart = $('<div class="post-like-pulse"><i class="fas fa-thumbs-up"></i></div>')
            $(this).append($heart)
            setTimeout(function () { $heart.remove() }, 700)
        })

        // ── Story options (own stories only) ────────────────
        $(document).on('click', '[data-story-options]', function (e) {
            e.stopPropagation()
            S.storyOptId = $(this).data('story-options')
            $('#story-delete-confirm').addClass('hidden')
            $('#story-options-list').removeClass('hidden')
            openModal('story-options')
        })
        $(document).on('click', '#opt-delete-story', function () {
            $('#story-options-list').addClass('hidden')
            $('#story-delete-confirm').removeClass('hidden')
        })
        $(document).on('click', '#btn-confirm-delete-story-cancel', function () {
            $('#story-delete-confirm').addClass('hidden')
            $('#story-options-list').removeClass('hidden')
        })
        $(document).on('click', '#btn-confirm-delete-story-ok', function () {
            var sid = S.storyOptId
            S.storyOptId = null
            closeModal('story-options')
            deleteStory(sid)
        })

        // ── Back buttons ────────────────────────────────────
        $(document).on('click', '#btn-back-profile', function () { goTo('home') })
        $(document).on('click', '#btn-back-convo', function () { goTo('messages') })

        // ── Profile actions ─────────────────────────────────
        $(document).on('click', '#btn-open-edit-profile', openEditProfile)
        $(document).on('click', '#btn-save-profile', saveProfile)
        $(document).on('click', '#btn-open-profile-options', function () {
            // Reset to list view in case confirm step is showing
            $('#profile-options-list').removeClass('hidden')
            $('#profile-delete-confirm').addClass('hidden')
            $('#modal-profile-options').removeClass('hidden')
        })
        $(document).on('click', '#btn-logout', logout)
        $(document).on('click', '#btn-delete-account', function () {
            $('#profile-options-list').addClass('hidden')
            $('#profile-delete-confirm').removeClass('hidden')
        })
        $(document).on('click', '#btn-confirm-delete-cancel', function () {
            $('#profile-delete-confirm').addClass('hidden')
            $('#profile-options-list').removeClass('hidden')
        })
        $(document).on('click', '#btn-confirm-delete-ok', deleteAccount)
        $(document).on('click', '#btn-recover-account', openRecover)
        $(document).on('click', '[data-switch-account]', function () {
            switchAccount($(this).data('switch-account'))
        })

        $(document).on('click', '#btn-edit-cover', async function () {
            var url = await pickPhoto()
            if (!url) return
            S.me.cover = url
            save()
            renderProfile(null)
        })

        $(document).on('click', '#btn-edit-avatar', async function () {
            var url = await pickPhoto()
            if (!url) return
            S.me.avatar = url
            S.me.avatarColor = null
            save()
            updateNavAvatar()
            renderProfile(null)
        })

        $(document).on('click', '#btn-ep-cover', async function () {
            var url = await pickPhoto()
            if (!url) return
            S.me.cover = url
            $('#ep-cover-preview').css({ backgroundImage: 'url(' + url + ')', backgroundSize: 'cover', backgroundPosition: 'center' })
            save()
        })

        $(document).on('click', '#btn-ep-avatar', async function () {
            var url = await pickPhoto()
            if (!url) return
            S.me.avatar = url
            S.me.avatarColor = null
            $('#ep-avatar-preview').html(avatarHtml(S.me, 'xl'))
            save()
        })

        // ── Friends actions ─────────────────────────────────
        $(document).on('click', '#btn-open-add-friend', function (e) {
            e.stopPropagation()
            openModal('add-friend')
            $('#add-friend-input').val('').focus()
        })

        $(document).on('click', '#btn-do-add-friend', function () {
            var query = $('#add-friend-input').val().trim().toLowerCase()
            if (!query) return
            // Search across friends AND knownUsers by name or username
            var found = allKnownPeople().find(function (u) {
                return (u.username || '').toLowerCase() === query
                    || u.name.toLowerCase() === query
                    || u.name.toLowerCase().includes(query)
                    || (u.username || '').toLowerCase().includes(query)
            })
            if (found) {
                if (S.friends.some(function (f) { return f.id === found.id })) {
                    showToast('Framebook', 'Already friends with ' + found.name + '!')
                } else {
                    sendFriendRequest(found.id)
                }
            } else {
                showToast('Framebook', 'User not found. They must be online and have posted or messaged you.')
            }
            closeModal('add-friend')
        })

        $(document).on('click', '[data-send-req]', function (e) { e.stopPropagation(); sendFriendRequest($(this).data('send-req')) })
        $(document).on('click', '[data-accept-req]', function (e) { e.stopPropagation(); acceptRequest($(this).data('accept-req')) })
        $(document).on('click', '[data-decline-req]', function (e) { e.stopPropagation(); declineRequest($(this).data('decline-req')) })
        $(document).on('click', '[data-unfriend]', function (e) { e.stopPropagation(); unfriend($(this).data('unfriend')) })
        $(document).on('click', '[data-add-friend]', function (e) { e.stopPropagation(); sendFriendRequest($(this).data('add-friend')) })
        $(document).on('click', '[data-toggle-follow]', function (e) { e.stopPropagation(); toggleFollow($(this).data('toggle-follow')) })

        // ── Messaging from profile / friends ────────────────
        $(document).on('click', '[data-msg-friend]', function (e) {
            e.stopPropagation()
            var fid = $(this).data('msg-friend')
            var fu = findUser(fid) || {}
            goTo('convo', { uid: fid, userName: fu.name })
        })

        // ── Chat list ───────────────────────────────────────
        $(document).on('click', '[data-open-convo]', function () {
            var uid = $(this).data('open-convo')
            var u = findUser(uid) || { name: uid }
            goTo('convo', { uid: uid, userName: u.name })
        })

        // ── Send message ────────────────────────────────────
        $(document).on('click', '#btn-msg-send', function () {
            var text = $('#msg-text-input').val().trim()
            if (text && S.chatUid) {
                sendMessage(S.chatUid, text, null)
                $('#msg-text-input').val('')
            }
        })

        $(document).on('keydown', '#msg-text-input', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault()
                var text = $(this).val().trim()
                if (text && S.chatUid) { sendMessage(S.chatUid, text, null); $(this).val('') }
            }
        })

        $(document).on('click', '#btn-msg-photo', async function () {
            var url = await pickPhoto()
            if (url && S.chatUid) sendMessage(S.chatUid, null, url)
        })

        // ── Populate feelings grid ──────────────────────────
        var feelingsHtml = FEELINGS.map(function (f) {
            return '<div class="feeling-item" data-emoji="' + esc(f.emoji) + '" data-text="' + esc(f.text) + '">' +
                '  <span class="feeling-emoji">' + f.emoji + '</span>' +
                '  <span class="feeling-text">' + f.text + '</span>' +
                '</div>'
        }).join('')
        $('#feelings-grid').html(feelingsHtml)

    }) // end $(function)

    // ══════════════════════════════════════════════════════════
    // BOOT
    // ══════════════════════════════════════════════════════════
    // Apply locale strings to static HTML elements
    function applyLocale() {
        // Login screen
        $('#login-name').attr('placeholder', t('loginName', 'Full Name'))
        $('#login-username').attr('placeholder', t('loginUsername', 'Username (no spaces)'))
        $('#login-bio').attr('placeholder', t('loginBio', 'Bio (optional)'))
        $('#btn-create-account').text(t('loginBtn', 'Create Account'))
        $('#btn-recover-account').text(t('forgotAccount', 'Forgot your account?'))
        $('.login-tagline').text(t('loginSubtitle', 'Connect with friends and the world around you.'))
        // Post create placeholder
        $('#btn-open-create-post').text(t('whatsOnMind', "What's on your mind?"))
        $('#cp-text').attr('placeholder', t('whatsOnMind', "What's on your mind?"))
        // Comment placeholder
        $('#comment-text-field').attr('placeholder', t('addComment', 'Write a comment...'))
        // Msg input
        $('#msg-text-input').attr('placeholder', t('typeMessage', 'Aa'))
        // Message input search placeholder
        $('#search-input').attr('placeholder', t('searchPlaceholder', 'Search Framebook...'))
        // Nav header titles
        $('#hdr-feeds .fb-header-title').text(t('navFeeds', 'Feeds'))
        $('#hdr-friends .fb-header-title').text(t('friends', 'Friends'))
        $('#hdr-notifs .fb-header-title').text(t('notifications', 'Notifications'))
        $('#hdr-messages .fb-header-title').text(t('messages', 'Messages'))
        // Feeds subtabs
        $('[data-filter="all"]').text(t('feedAll', 'All'))
        $('[data-filter="favorites"]').text(t('feedFavorites', 'Favorites'))
        $('[data-filter="friends"]').text(t('feedFriends', 'Friends'))
        // Shortcut buttons
        $('#btn-shortcut-photo').html('<i class="fas fa-image" style="color:#45bd62"></i> ' + t('postPhoto', 'Photo'))
        $('#btn-shortcut-feeling').html('<i class="fas fa-smile" style="color:#f7b928"></i> ' + t('postFeeling', 'Feeling'))
        // Notifs empty
        $('#notifs-empty p').text(t('noNotifications', 'No notifications yet'))
        // Chats empty
        $('#chats-empty p').text(t('noChats', 'Add friends to start messaging'))
        // Profile options
        $('#btn-logout').find('span').text(t('logOut', 'Log Out'))
        $('#btn-delete-account').find('span').text(t('deleteAccount', 'Delete Account'))
        $('#profile-delete-confirm .confirm-message').text(t('deleteAccountConfirm', 'Permanently delete your account? This cannot be undone.'))
        $('#btn-confirm-delete-cancel').text(t('cancel', 'Cancel'))
        $('#btn-confirm-delete-ok').text(t('yesDeleteAccount', 'Yes, Delete Account'))
        // Recover modal
        $('.modal-topbar-title', '#modal-recover').text(t('yourAccounts', 'Your Accounts'))
        $('#recover-empty p').text(t('noAccountsFound', 'No accounts found for this character'))
        // Story options modal
        $('#opt-delete-story span').text(t('deleteStory', 'Delete Story'))
        $('#story-delete-confirm .confirm-message').text(t('deleteStoryConfirm', 'Delete this story?'))
        $('#btn-confirm-delete-story-cancel').text(t('cancel', 'Cancel'))
        $('#btn-confirm-delete-story-ok').text(t('yesDeleteAccount', 'Yes, Delete'))
        // Conversation header status — actual text is set per-chat by updateConvoStatus
        // Friends tab section labels
        $('#lbl-friend-requests').text(t('friendRequests', 'Friend Requests'))
        $('#lbl-people-you-may-know').text(t('peopleYouMayKnow', 'People You May Know'))
        $('#friends-section-label').html(t('friends', 'Friends') + ' (<span id="friends-count">0</span>)')
        $('#friends-empty p').text(t('noFriends', 'No friends yet'))
        // Create story label
        $('#btn-create-story .story-card-label').text(t('createStory', 'Create a Story'))
        // Shortcut reel
        $('#btn-shortcut-reel').html('<i class="fas fa-film" style="color:#f02849"></i> ' + t('reel', 'Reel'))
        // Feed end
        $('#feed-end').html(t('allCaughtUp', "You're all caught up") + ' <i class="fas fa-check-circle"></i>')
    }

    async function boot() {
        // Load locale first so all subsequent renders use correct strings
        var localeResult = await nuiFetch('framebook:getLocale')
        if (localeResult && localeResult.ok && localeResult.locale) {
            L = localeResult.locale
        }
        if (localeResult && localeResult.ok && localeResult.config) {
            CFG = Object.assign(CFG, localeResult.config)
        }
        applyLocale()

        var info = await nuiFetch('framebook:getPlayerInfo')
        if (info && info.ok && info.name) {
            S.playerName = info.name
            S.myServerId = info.id || null
        }

        load()
        // Always refresh serverId in case player reconnected
        if (S.me && S.myServerId) S.me.serverId = S.myServerId

        if (pendingAiAccount) {
            applyAiAccount(pendingAiAccount)
        } else if (S.me) {
            populateKnownUsersFromPosts()
            launchApp()
        } else {
            showLoginView()
        }
        bootDone = true
    }

    var bootDone = false
    var pendingAiAccount = null

    function applyAiAccount(account) {
        if (!account) return
        var email = String(account.email || '')
        var local = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '')
        if (!local) {
            local = String((account.firstName || '') + (account.lastName || '')).toLowerCase().replace(/[^a-z0-9]/g, '') || 'aiuser'
        }
        var name = [account.firstName, account.lastName].filter(Boolean).join(' ').trim() || local
        var id = 'ai_' + local
        S._aiLogin = true
        S.playerName = name
        var raw = localStorage.getItem(accountKey(id))
        if (raw) {
            try {
                var saved = JSON.parse(raw)
                clearState()
                Object.assign(S, saved)
                S._aiLogin = true
                S.playerName = name
                if (S.me) {
                    S.me.name = name
                    S.me.username = local
                    if (account.avatar) S.me.avatar = account.avatar
                    S.me.serverId = S.myServerId || S.me.serverId || null
                }
                localStorage.setItem(activeKey(), id)
                save()
                launchApp()
                return
            } catch (e) { /* create a fresh profile from the phone account */ }
        }
        clearState()
        S._aiLogin = true
        S.playerName = name
        S.me = {
            id: id,
            name: name,
            username: local,
            bio: '',
            avatar: account.avatar || null,
            cover: null,
            avatarColor: avatarColor(name),
            serverId: S.myServerId || null,
        }
        save()
        launchApp()
    }

    window.addEventListener('message', function (event) {
        var msg = event.data
        if (!msg || msg.source !== 'smartphone-host' || msg.type !== 'init') return
        if (!msg.payload) return
        if (msg.payload.theme) {
            document.documentElement.setAttribute('data-theme', msg.payload.theme === 'dark' ? 'dark' : 'light')
        }
        if (!msg.payload.aiAccount) return
        pendingAiAccount = msg.payload.aiAccount
        if (bootDone) applyAiAccount(pendingAiAccount)
    })

    // Expose closeSearch globally for inline onclick in search results
    window.closeSearch = closeSearch

    // Refresh user list every 30s; poll for events every 5s
    setInterval(function () { if (S.me) refreshUserList() }, 30000)
    setInterval(function () { if (S.me) pollEvents() }, 5000)

    window.addEventListener('load', function () {
        void boot()
    })

})(jQuery)
