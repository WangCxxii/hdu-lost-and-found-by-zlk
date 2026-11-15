/* 极简 API 客户端：同源 /api，或由 js/config.js 指定后端。 */
(function (global) {
  'use strict';

  const base = String((global.HDU_CONFIG && global.HDU_CONFIG.apiBase) || '').replace(/\/+$/, '');
  const TOKEN_KEY = 'hdu_token_v2';
  let token = '';
  try {
    token = localStorage.getItem(TOKEN_KEY) || '';
  } catch (e) {
    token = '';
  }
  let probed = null;

  function setToken(value) {
    token = value || '';
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  async function request(path, options) {
    const opts = options || {};
    const headers = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    let response;
    try {
      response = await fetch(base + path, {
        method: opts.method || 'GET',
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        cache: 'no-store'
      });
    } catch (error) {
      throw new Error('无法连接服务器');
    }
    let data = null;
    try {
      data = await response.json();
    } catch (e) {
      data = null;
    }
    if (response.status === 401 && path !== '/api/auth/login') setToken('');
    if (!response.ok) {
      const error = new Error((data && data.error) || '请求失败');
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  async function probe() {
    if (probed !== null) return probed;
    try {
      const response = await fetch(base + '/api/health', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) {
        probed = false;
        return false;
      }
      const data = await response.json();
      probed = !!(data && data.ok);
    } catch (e) {
      probed = false;
    }
    return probed;
  }

  const api = {
    base,
    probe,
    setToken,
    clearToken: () => setToken(''),
    hasToken: () => !!token,
    request,
    login: (studentId, password) => request('/api/auth/login', { method: 'POST', body: { studentId, password } }),
    bootstrap: () => request('/api/bootstrap'),
    createItem: (body) => request('/api/items', { method: 'POST', body }),
    updateItem: (id, body) => request('/api/items/' + encodeURIComponent(id), { method: 'PATCH', body }),
    deleteItem: (id) => request('/api/items/' + encodeURIComponent(id), { method: 'DELETE' }),
    contact: (id) => request('/api/items/' + encodeURIComponent(id) + '/contact'),
    matches: (id) => request('/api/items/' + encodeURIComponent(id) + '/matches'),
    claim: (id, body) => request('/api/items/' + encodeURIComponent(id) + '/claims', { method: 'POST', body }),
    approve: (id) => request('/api/claims/' + encodeURIComponent(id) + '/approve', { method: 'POST', body: {} }),
    reject: (id) => request('/api/claims/' + encodeURIComponent(id) + '/reject', { method: 'POST', body: {} }),
    claimantConfirm: (id, code) => request('/api/claims/' + encodeURIComponent(id) + '/claimant-confirm', { method: 'POST', body: { code } }),
    ownerConfirm: (id) => request('/api/claims/' + encodeURIComponent(id) + '/owner-confirm', { method: 'POST', body: {} }),
    readNotifications: (id) => request('/api/notifications/read', { method: 'POST', body: id ? { id } : {} }),
    updateMe: (body) => request('/api/me', { method: 'PATCH', body }),
    report: (body) => request('/api/reports', { method: 'POST', body })
  };

  global.HDUApi = api;
})(window);
