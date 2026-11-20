// Polotno key resolution, shared by all scripts. POLOTNO_API_KEY always wins.
// PUBLIC_DEMO_KEY is a public, origin-restricted demo key for this skill, not a secret.
const PUBLIC_DEMO_KEY = 'OHugcRCWcnsAo-JLWnuC';

module.exports.KEY = process.env.POLOTNO_API_KEY || PUBLIC_DEMO_KEY;
