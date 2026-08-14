// Polotno key resolution, shared by all scripts. POLOTNO_API_KEY always
// wins; otherwise the bundled key ships assembled at runtime (it is
// origin-restricted server-side — the assembly only keeps it out of
// grep-level scrapers, not out of determined hands).
const PARTS = ['T0h1Z2NSQ1dj', 'bnNBby1KTFdudUM='];

module.exports.KEY =
  process.env.POLOTNO_API_KEY || Buffer.from(PARTS.join(''), 'base64').toString('utf8');
