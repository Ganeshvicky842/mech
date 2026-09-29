window.wrenchApi = {
  async request(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      credentials: 'same-origin',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const payload = response.status === 204 ? null : await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(payload?.error || `Request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return payload;
  },
  async send(path, method, body) {
    return this.request(path, { method, body: JSON.stringify(body) });
  }
};
