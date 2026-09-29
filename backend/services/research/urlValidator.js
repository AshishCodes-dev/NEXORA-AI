const dns = require('dns').promises;
const net = require('net');

/**
 * Checks whether an IP address belongs to private, loopback, link-local,
 * multicast, or reserved ranges.
 * 
 * @param {string} rawIp - IPv4 or IPv6 address string
 * @returns {boolean} True if the IP is private or reserved
 */
function isPrivateIp(rawIp) {
  if (!rawIp || typeof rawIp !== 'string') return true;

  let ip = rawIp.trim();

  // IPv6 loopback or unspecified
  if (ip === '::1' || ip === '::' || ip === '0:0:0:0:0:0:0:1' || ip === '0:0:0:0:0:0:0:0') {
    return true;
  }

  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  if (ip.toLowerCase().startsWith('::ffff:')) {
    ip = ip.substring(7);
  }

  if (!net.isIPv4(ip)) {
    const lower = ip.toLowerCase();
    // Unique local (fc00::/7) or link-local (fe80::/10)
    if (lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
      return true;
    }
    return false;
  }

  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => isNaN(n) || n < 0 || n > 255)) {
    return true;
  }

  // 0.0.0.0/8 (Current network)
  if (parts[0] === 0) return true;

  // 10.0.0.0/8 (Private)
  if (parts[0] === 10) return true;

  // 100.64.0.0/10 (Carrier-grade NAT)
  if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;

  // 127.0.0.0/8 (Loopback)
  if (parts[0] === 127) return true;

  // 169.254.0.0/16 (Link-local / Cloud metadata: 169.254.169.254)
  if (parts[0] === 169 && parts[1] === 254) return true;

  // 172.16.0.0/12 (Private)
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true;

  // 192.0.2.0/24 (TEST-NET-1)
  if (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) return true;

  // 192.168.0.0/16 (Private)
  if (parts[0] === 192 && parts[1] === 168) return true;

  // 198.18.0.0/15 (Network benchmark tests)
  if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true;

  // 198.51.100.0/24 (TEST-NET-2)
  if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true;

  // 203.0.113.0/24 (TEST-NET-3)
  if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true;

  // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved) & 255.255.255.255 (Broadcast)
  if (parts[0] >= 224) return true;

  return false;
}

/**
 * Validates a target URL against SSRF vulnerabilities.
 * Checks protocol, hostnames, direct IP literals, and DNS-resolved IP addresses.
 * 
 * @param {string} rawUrl - The URL to validate
 * @returns {Promise<{ isValid: boolean, url?: string, reason?: string, resolvedIps?: string[] }>}
 */
async function validateSafeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { isValid: false, reason: 'EMPTY_OR_NON_STRING_URL' };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (err) {
    return { isValid: false, reason: 'INVALID_URL_SYNTAX' };
  }

  // 1. Protocol check: strictly http or https
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { isValid: false, reason: `UNSAFE_PROTOCOL: ${parsed.protocol}` };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    return { isValid: false, reason: 'EMPTY_HOSTNAME' };
  }

  // 2. Reject well-known local/internal/metadata hostnames
  const blockedHostnames = [
    'localhost',
    'metadata.google.internal',
    'instance-data',
    'metadata.turing.com',
    'api.internal',
  ];

  if (
    blockedHostnames.includes(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.test') ||
    hostname.endsWith('.example') ||
    hostname.endsWith('.invalid')
  ) {
    return { isValid: false, reason: `BLOCKED_HOSTNAME: ${hostname}` };
  }

  // Strip brackets if IPv6 literal: e.g. [::1] -> ::1
  const cleanHost = hostname.replace(/^\[|\]$/g, '');

  // 3. Literal IP validation
  if (net.isIP(cleanHost)) {
    if (isPrivateIp(cleanHost)) {
      return { isValid: false, reason: `PRIVATE_OR_RESERVED_IP: ${cleanHost}` };
    }
    return { isValid: true, url: parsed.href, resolvedIps: [cleanHost] };
  }

  // 4. Domain Name DNS Resolution & IP Check
  try {
    const addresses = await dns.lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      return { isValid: false, reason: 'DNS_RESOLUTION_EMPTY' };
    }

    const resolvedIps = [];
    for (const record of addresses) {
      resolvedIps.push(record.address);
      if (isPrivateIp(record.address)) {
        return {
          isValid: false,
          reason: `DNS_RESOLVED_PRIVATE_IP: ${record.address} for host ${hostname}`,
        };
      }
    }

    return { isValid: true, url: parsed.href, resolvedIps };
  } catch (dnsErr) {
    return { isValid: false, reason: `DNS_RESOLUTION_FAILED: ${dnsErr.code || dnsErr.message}` };
  }
}

module.exports = {
  validateSafeUrl,
  isPrivateIp,
};
