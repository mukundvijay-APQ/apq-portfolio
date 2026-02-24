/* ============================================================
   APQ Comments System — Firebase-Powered Widget
   
   Features:
   - Persistent comments (Firebase Realtime DB)
   - Google Sign-In OR LinkedIn Sign-In (dual auth)
   - Nested replies (one level deep)
   - Like / unlike (one per user)
   - Admin: edit & delete any comment (by email match)
   - Real-time updates (no refresh needed)
   - Email notification trigger (via Cloud Function)
   
   SETUP:
   1. Replace the firebaseConfig below with your own
   2. Set ADMIN_EMAIL to your Google account email
   3. Set LINKEDIN_CLIENT_ID from LinkedIn Developer portal
   4. Include Firebase SDK scripts before this file
   ============================================================ */

(function () {
  'use strict';

  // Wait for Firebase SDK to be available
  function waitForFirebase(callback, maxRetries) {
    if (typeof firebase !== 'undefined' && firebase.app) {
      callback();
    } else if (maxRetries > 0) {
      setTimeout(() => waitForFirebase(callback, maxRetries - 1), 100);
    } else {
      console.error('[APQ] Firebase SDK not loaded');
    }
  }

  waitForFirebase(initComments, 50);

  function initComments() {

  // ========================
  //  🔧 CONFIGURATION
  // ========================

  const firebaseConfig = {
    apiKey: "AIzaSyDl6DJOpyPH8GURCei4UsKX31Rg60W4UtQ",
    authDomain: "apq-portfolio.firebaseapp.com",
    databaseURL: "https://apq-portfolio-default-rtdb.firebaseio.com",
    projectId: "apq-portfolio",
    storageBucket: "apq-portfolio.firebasestorage.app",
    messagingSenderId: "388190429929",
    appId: "1:388190429929:web:a2365d021105e8ea9e4678"
  };

  // Admin email — gets edit/delete rights on ALL comments
  const ADMIN_EMAIL = 'mukundvijay@gmail.com';

  // LinkedIn OAuth — from LinkedIn Developer Portal
  // TODO: Replace with your LinkedIn app's Client ID
  const LINKEDIN_CLIENT_ID = 'YOUR_LINKEDIN_CLIENT_ID';

  // Your Cloud Function URL for LinkedIn token exchange
  // After deploying, it will be something like:
  // https://us-central1-YOUR_PROJECT.cloudfunctions.net/linkedinAuth
  const LINKEDIN_AUTH_FUNCTION_URL = 'https://us-central1-apq-portfolio.cloudfunctions.net/linkedinAuth';

  // Redirect URI must match what's configured in LinkedIn Developer Portal
  const LINKEDIN_REDIRECT_URI = window.location.origin + window.location.pathname;

  // ========================
  //  Firebase Init
  // ========================

  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  const auth = firebase.auth();
  const db = firebase.database();
  const googleProvider = new firebase.auth.GoogleAuthProvider();

  // ========================
  //  State
  // ========================

  let currentUser = null;
  let isAdmin = false;
  let comments = {};
  let articleId = '';
  let replyingTo = null;
  let editingId = null;
  let authLoading = false;

  // ========================
  //  SVG Icons
  // ========================

  const ICONS = {
    google: `<svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>`,
    linkedin: `<svg width="16" height="16" viewBox="0 0 24 24" fill="#0A66C2"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`,
    heart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
    heartFilled: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>`,
    reply: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>`,
    edit: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
    verified: `<svg width="14" height="14" viewBox="0 0 24 24" fill="#0A66C2"><path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81C14.67 2.63 13.43 1.75 12 1.75S9.33 2.63 8.66 3.94c-1.39-.46-2.9-.2-3.91.81s-1.27 2.52-.81 3.91C2.63 9.33 1.75 10.57 1.75 12s.88 2.67 2.19 3.34c-.46 1.39-.2 2.9.81 3.91s2.52 1.27 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.67-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z"/></svg>`,
  };

  // ========================
  //  Utilities
  // ========================

  function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(months / 12)}y ago`;
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function getInitials(name) {
    return (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  function countAllComments(commentsObj) {
    let count = 0;
    Object.values(commentsObj || {}).forEach(c => {
      if (!c.deleted) {
        count++;
        if (c.replies) {
          Object.values(c.replies).forEach(r => {
            if (!r.deleted) count++;
          });
        }
      }
    });
    return count;
  }

  function getLikeCount(likesObj) {
    return Object.keys(likesObj || {}).length;
  }

  function hasUserLiked(likesObj) {
    return currentUser && likesObj && likesObj[currentUser.uid];
  }

  // ========================
  //  Auth — Google
  // ========================

  function signInGoogle() {
    console.log('[APQ] signInGoogle called — opening popup...');
    auth.signInWithPopup(googleProvider).then(result => {
      console.log('[APQ] Popup sign-in success:', result.user.email);
    }).catch(err => {
      console.warn('[APQ] Popup sign-in error:', err.code, err.message);
    });
  }

  // ========================
  //  Auth — LinkedIn (OAuth 2.0 → Cloud Function → Custom Token)
  // ========================

  function signInLinkedIn() {
    const state = Math.random().toString(36).substring(2) + Date.now().toString(36);
    sessionStorage.setItem('apq_linkedin_state', state);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: LINKEDIN_CLIENT_ID,
      redirect_uri: LINKEDIN_REDIRECT_URI,
      scope: 'openid profile email',
      state: state
    });

    window.location.href = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  }

  async function handleLinkedInCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    const savedState = sessionStorage.getItem('apq_linkedin_state');

    if (!code) return false;

    // Clean URL immediately
    window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
    sessionStorage.removeItem('apq_linkedin_state');

    if (state !== savedState) {
      console.error('LinkedIn auth: state mismatch');
      return false;
    }

    authLoading = true;
    render();

    try {
      const response = await fetch(LINKEDIN_AUTH_FUNCTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, redirectUri: LINKEDIN_REDIRECT_URI })
      });

      if (!response.ok) throw new Error(`Auth function returned ${response.status}`);
      const data = await response.json();

      await auth.signInWithCustomToken(data.firebaseToken);

      // Update profile with LinkedIn data
      if (data.profile && auth.currentUser) {
        const updates = {};
        if (data.profile.name) updates.displayName = data.profile.name;
        if (data.profile.picture) updates.photoURL = data.profile.picture;
        if (Object.keys(updates).length > 0) {
          await auth.currentUser.updateProfile(updates);
        }
        await db.ref(`users/${auth.currentUser.uid}`).update({
          name: data.profile.name || '',
          email: data.profile.email || '',
          photo: data.profile.picture || '',
          provider: 'linkedin',
          linkedinVerified: true,
          lastLogin: firebase.database.ServerValue.TIMESTAMP
        });
      }

      authLoading = false;
      render();
      return true;
    } catch (err) {
      console.error('LinkedIn auth error:', err);
      authLoading = false;
      render();
      return false;
    }
  }

  function signOut() {
    auth.signOut();
  }

  // Provider tracking
  let userProviderCache = {};

  auth.onAuthStateChanged(async (user) => {
    currentUser = user;
    isAdmin = user && user.email === ADMIN_EMAIL;

    if (user) {
      try {
        const snap = await db.ref(`users/${user.uid}/provider`).once('value');
        userProviderCache[user.uid] = snap.val() || 'google';
      } catch (e) {
        // Default to google if we can't determine
        if (user.providerData && user.providerData.length > 0) {
          userProviderCache[user.uid] = 'google';
        } else {
          userProviderCache[user.uid] = 'linkedin';
        }
      }
    }

    render();
  });

  function getCurrentProvider() {
    if (!currentUser) return null;
    return userProviderCache[currentUser.uid] || 'google';
  }

  // ========================
  //  Database Operations
  // ========================

  function getCommentsRef() {
    return db.ref(`comments/${articleId}`);
  }

  function postComment(text) {
    if (!currentUser || !text.trim()) return;
    const provider = getCurrentProvider();
    const commentRef = getCommentsRef().push();
    return commentRef.set({
      uid: currentUser.uid,
      name: currentUser.displayName || 'Anonymous',
      email: currentUser.email || '',
      photo: currentUser.photoURL || '',
      text: text.trim(),
      timestamp: firebase.database.ServerValue.TIMESTAMP,
      edited: false,
      provider: provider,
      linkedinVerified: provider === 'linkedin'
    });
  }

  function postReply(parentId, text) {
    if (!currentUser || !text.trim()) return;
    const provider = getCurrentProvider();
    const replyRef = getCommentsRef().child(`${parentId}/replies`).push();
    return replyRef.set({
      uid: currentUser.uid,
      name: currentUser.displayName || 'Anonymous',
      email: currentUser.email || '',
      photo: currentUser.photoURL || '',
      text: text.trim(),
      timestamp: firebase.database.ServerValue.TIMESTAMP,
      edited: false,
      provider: provider,
      linkedinVerified: provider === 'linkedin'
    });
  }

  function editComment(commentId, replyId, newText) {
    const path = replyId ? `${commentId}/replies/${replyId}` : commentId;
    return getCommentsRef().child(path).update({
      text: newText.trim(),
      edited: true,
      editedAt: firebase.database.ServerValue.TIMESTAMP
    });
  }

  function deleteComment(commentId, replyId) {
    const path = replyId ? `${commentId}/replies/${replyId}` : commentId;
    return getCommentsRef().child(path).update({
      deleted: true,
      text: '[deleted]',
      deletedAt: firebase.database.ServerValue.TIMESTAMP
    });
  }

  function toggleLike(commentId, replyId) {
    if (!currentUser) return;
    const path = replyId
      ? `${commentId}/replies/${replyId}/likes/${currentUser.uid}`
      : `${commentId}/likes/${currentUser.uid}`;
    const ref = getCommentsRef().child(path);
    ref.once('value').then(snap => {
      snap.exists() ? ref.remove() : ref.set(true);
    });
  }

  // ========================
  //  Rendering
  // ========================

  function render() {
    const container = document.getElementById('apq-comments');
    if (!container) return;

    if (authLoading) {
      container.innerHTML = `
        <div class="apq-c-header"><h3>Discussion</h3></div>
        <div class="apq-c-loading">
          <div class="apq-c-spinner"></div>
          <span style="margin-left:10px;font-size:0.85rem;color:#888;">Signing in with LinkedIn...</span>
        </div>
      `;
      return;
    }

    const totalCount = countAllComments(comments);

    container.innerHTML = `
      <div class="apq-c-header">
        <h3>Discussion <span class="apq-c-count">${totalCount}</span></h3>
        <div class="apq-c-auth">
          ${currentUser ? renderAuthUser() : ''}
        </div>
      </div>
      ${renderCompose()}
      <ul class="apq-c-list">
        ${renderCommentsList()}
      </ul>
    `;

    bindEvents();
  }

  function renderAuthUser() {
    const provider = getCurrentProvider();

    return `
      ${currentUser.photoURL
        ? `<img class="apq-c-auth-avatar" src="${currentUser.photoURL}" alt="" referrerpolicy="no-referrer">`
        : `<div class="apq-c-avatar-placeholder" style="width:28px;height:28px;font-size:0.65rem;">${getInitials(currentUser.displayName)}</div>`
      }
      <span class="apq-c-auth-name">${escapeHtml(currentUser.displayName || 'User')}</span>
      ${provider === 'linkedin' ? '<span class="apq-c-provider-badge apq-c-linkedin-badge">LinkedIn ' + ICONS.verified + '</span>' : ''}
      ${isAdmin ? '<span class="apq-c-auth-badge">Admin</span>' : ''}
      <button class="apq-c-btn-signout" data-action="signout">Sign Out</button>
    `;
  }

  function renderCompose() {
    if (!currentUser) {
      return `
        <div class="apq-c-compose">
          <div class="apq-c-compose-login-prompt">
            <p style="margin:0 0 1rem;font-size:0.92rem;color:#555;">Sign in to join the discussion</p>
            <div class="apq-c-auth-buttons">
              <button class="apq-c-btn-signin apq-c-btn-google" data-action="signin-google">
                ${ICONS.google}
                <span>Sign in with Google</span>
              </button>
              <button class="apq-c-btn-signin apq-c-btn-linkedin" data-action="signin-linkedin">
                ${ICONS.linkedin}
                <span>Sign in with LinkedIn</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }
    return `
      <div class="apq-c-compose">
        <textarea id="apq-compose-textarea" placeholder="Share your thoughts on this article..." rows="3"></textarea>
        <div class="apq-c-compose-footer">
          <span class="apq-c-compose-hint">Be constructive · All comments are public</span>
          <button class="apq-c-btn-post" data-action="post" id="apq-btn-post">Post Comment</button>
        </div>
      </div>
    `;
  }

  function renderCommentsList() {
    const sorted = Object.entries(comments)
      .filter(([, c]) => !c.deleted || (c.replies && Object.values(c.replies).some(r => !r.deleted)))
      .sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));

    if (sorted.length === 0) {
      return `
        <div class="apq-c-empty">
          <div class="apq-c-empty-icon">💬</div>
          <p>No comments yet. Be the first to share your thoughts!</p>
        </div>
      `;
    }

    return sorted.map(([id, c]) => renderComment(id, c, false)).join('');
  }

  function renderComment(id, c, isReply, parentId) {
    const commentId = isReply ? parentId : id;
    const replyId = isReply ? id : null;
    const isOwner = currentUser && currentUser.uid === c.uid;
    const canEdit = isOwner || isAdmin;
    const canDelete = isOwner || isAdmin;
    const isEditing = editingId === (isReply ? `${parentId}/${id}` : id);
    const liked = hasUserLiked(c.likes);
    const likeCount = getLikeCount(c.likes);
    const isDeleted = c.deleted;
    const isLinkedIn = c.provider === 'linkedin' || c.linkedinVerified;
    const isCommentAdmin = c.email === ADMIN_EMAIL;

    let bodyHtml;
    if (isDeleted) {
      bodyHtml = `<div class="apq-c-body" style="color:#aaa;font-style:italic;">[This comment has been deleted]</div>`;
    } else if (isEditing) {
      bodyHtml = `
        <div class="apq-c-body">
          <textarea class="apq-c-edit-area" id="apq-edit-textarea">${escapeHtml(c.text)}</textarea>
          <div class="apq-c-edit-actions">
            <button class="apq-c-btn-cancel" data-action="cancel-edit">Cancel</button>
            <button class="apq-c-btn-save" data-action="save-edit" data-comment-id="${commentId}" data-reply-id="${replyId || ''}">Save</button>
          </div>
        </div>
      `;
    } else {
      bodyHtml = `<div class="apq-c-body">${escapeHtml(c.text)}${c.edited ? ' <span class="apq-c-edited-tag">(edited)</span>' : ''}</div>`;
    }

    const actionsHtml = isDeleted ? '' : `
      <div class="apq-c-actions">
        ${currentUser ? `
          <button class="apq-c-action-btn ${liked ? 'liked' : ''}" data-action="like" data-comment-id="${commentId}" data-reply-id="${replyId || ''}">
            ${liked ? ICONS.heartFilled : ICONS.heart}
            ${likeCount > 0 ? `<span>${likeCount}</span>` : ''}
          </button>
          ${!isReply ? `
            <button class="apq-c-action-btn" data-action="reply" data-comment-id="${commentId}">
              ${ICONS.reply} Reply
            </button>
          ` : ''}
          ${canEdit ? `
            <button class="apq-c-action-btn apq-c-admin-btn" data-action="edit" data-edit-id="${isReply ? parentId + '/' + id : id}">
              ${ICONS.edit} Edit
            </button>
          ` : ''}
          ${canDelete ? `
            <button class="apq-c-action-btn apq-c-delete-btn" data-action="delete" data-comment-id="${commentId}" data-reply-id="${replyId || ''}">
              ${ICONS.trash} Delete
            </button>
          ` : ''}
        ` : `
          <span class="apq-c-action-btn" style="cursor:default;">
            ${ICONS.heart}
            ${likeCount > 0 ? `<span>${likeCount}</span>` : ''}
          </span>
        `}
      </div>
    `;

    let repliesHtml = '';
    if (!isReply && c.replies) {
      const sortedReplies = Object.entries(c.replies)
        .filter(([, r]) => !r.deleted)
        .sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));
      if (sortedReplies.length > 0) {
        repliesHtml = `
          <div class="apq-c-replies">
            ${sortedReplies.map(([rid, r]) => renderComment(rid, r, true, id)).join('')}
          </div>
        `;
      }
    }

    let replyComposeHtml = '';
    if (!isReply && replyingTo === id && currentUser) {
      replyComposeHtml = `
        <div class="apq-c-reply-compose">
          <textarea id="apq-reply-textarea" placeholder="Write a reply..." rows="2"></textarea>
          <div class="apq-c-reply-compose-actions">
            <button class="apq-c-btn-cancel" data-action="cancel-reply">Cancel</button>
            <button class="apq-c-btn-save" data-action="post-reply" data-comment-id="${id}">Reply</button>
          </div>
        </div>
      `;
    }

    const avatarHtml = c.photo && !isDeleted
      ? `<img class="apq-c-avatar" src="${c.photo}" alt="" referrerpolicy="no-referrer">`
      : `<div class="apq-c-avatar-placeholder">${isDeleted ? '?' : getInitials(c.name)}</div>`;

    const authorClass = isCommentAdmin ? 'apq-c-author apq-c-author-admin' : 'apq-c-author';
    const providerBadge = isLinkedIn && !isDeleted
      ? `<span class="apq-c-provider-badge apq-c-linkedin-badge-sm" title="Verified LinkedIn profile">${ICONS.verified}</span>`
      : '';

    return `
      <li class="apq-c-item">
        <div class="apq-c-item-head">
          ${avatarHtml}
          <div class="apq-c-meta">
            <span class="${authorClass}">${isDeleted ? 'Deleted' : escapeHtml(c.name)}</span>
            ${providerBadge}
            ${!isDeleted && isCommentAdmin ? '<span class="apq-c-auth-badge">Author</span>' : ''}
            <span class="apq-c-time">${c.timestamp ? timeAgo(c.timestamp) : ''}</span>
          </div>
        </div>
        ${bodyHtml}
        ${actionsHtml}
        ${repliesHtml}
        ${replyComposeHtml}
      </li>
    `;
  }

  // ========================
  //  Event Binding
  // ========================

  let eventsBound = false;

  function bindEvents() {
    const container = document.getElementById('apq-comments');
    if (!container || eventsBound) return;
    eventsBound = true;

    container.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;

      switch (action) {
        case 'signin-google': console.log('[APQ] Google button clicked'); signInGoogle(); break;
        case 'signin-linkedin': console.log('[APQ] LinkedIn button clicked'); signInLinkedIn(); break;
        case 'signout': signOut(); break;

        case 'post': {
          const textarea = document.getElementById('apq-compose-textarea');
          if (textarea && textarea.value.trim()) {
            btn.disabled = true;
            btn.textContent = 'Posting...';
            postComment(textarea.value).then(() => {
              textarea.value = '';
              btn.disabled = false;
              btn.textContent = 'Post Comment';
            }).catch(err => {
              console.error(err);
              btn.disabled = false;
              btn.textContent = 'Post Comment';
            });
          }
          break;
        }

        case 'like':
          toggleLike(btn.dataset.commentId, btn.dataset.replyId || null);
          break;

        case 'reply':
          replyingTo = btn.dataset.commentId;
          editingId = null;
          render();
          const rt = document.getElementById('apq-reply-textarea');
          if (rt) rt.focus();
          break;

        case 'cancel-reply': replyingTo = null; render(); break;

        case 'post-reply': {
          const textarea = document.getElementById('apq-reply-textarea');
          if (textarea && textarea.value.trim()) {
            btn.disabled = true;
            btn.textContent = 'Posting...';
            postReply(btn.dataset.commentId, textarea.value).then(() => {
              replyingTo = null;
              render();
            }).catch(err => {
              console.error(err);
              btn.disabled = false;
              btn.textContent = 'Reply';
            });
          }
          break;
        }

        case 'edit':
          editingId = btn.dataset.editId;
          replyingTo = null;
          render();
          const et = document.getElementById('apq-edit-textarea');
          if (et) { et.focus(); et.setSelectionRange(et.value.length, et.value.length); }
          break;

        case 'cancel-edit': editingId = null; render(); break;

        case 'save-edit': {
          const textarea = document.getElementById('apq-edit-textarea');
          const { commentId, replyId } = btn.dataset;
          if (textarea && textarea.value.trim()) {
            btn.disabled = true;
            btn.textContent = 'Saving...';
            editComment(commentId, replyId || null, textarea.value).then(() => {
              editingId = null;
              render();
            }).catch(err => {
              console.error(err);
              btn.disabled = false;
              btn.textContent = 'Save';
            });
          }
          break;
        }

        case 'delete':
          showDeleteModal(btn.dataset.commentId, btn.dataset.replyId || null);
          break;

        case 'confirm-delete': {
          const overlay = document.querySelector('.apq-c-modal-overlay');
          deleteComment(overlay.dataset.commentId, overlay.dataset.replyId || null).then(() => overlay.remove());
          break;
        }

        case 'cancel-delete': {
          const overlay = document.querySelector('.apq-c-modal-overlay');
          if (overlay) overlay.remove();
          break;
        }
      }
    });
  }

  function showDeleteModal(commentId, replyId) {
    const existing = document.querySelector('.apq-c-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.className = 'apq-c-modal-overlay';
    overlay.dataset.commentId = commentId;
    overlay.dataset.replyId = replyId || '';
    overlay.innerHTML = `
      <div class="apq-c-modal">
        <h4>Delete Comment</h4>
        <p>This action cannot be undone. The comment will be permanently removed.</p>
        <div class="apq-c-modal-btns">
          <button class="apq-c-btn-cancel" data-action="cancel-delete">Cancel</button>
          <button class="apq-c-btn-delete-confirm" data-action="confirm-delete">Delete</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }

  // ========================
  //  Initialize
  // ========================

  async function init() {
    const container = document.getElementById('apq-comments');
    if (!container) {
      console.warn('APQ Comments: No #apq-comments element found.');
      return;
    }

    articleId = container.dataset.articleId || 'default';
    container.innerHTML = '<div class="apq-c-loading"><div class="apq-c-spinner"></div></div>';

    // Check for LinkedIn OAuth callback
    await handleLinkedInCallback();

    // Listen for real-time updates
    getCommentsRef().on('value', snapshot => {
      comments = snapshot.val() || {};

      // Cache provider info for all comment authors
      Object.values(comments).forEach(c => {
        if (c.uid && c.provider) userProviderCache[c.uid] = c.provider;
        if (c.replies) {
          Object.values(c.replies).forEach(r => {
            if (r.uid && r.provider) userProviderCache[r.uid] = r.provider;
          });
        }
      });

      render();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  } // end initComments

})();
