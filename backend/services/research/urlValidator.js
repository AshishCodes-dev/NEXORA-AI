const dns = require('dns').promises;
const net = require('net');

/**
 * Checks whether an IPv4 numeric array [a, b, c, d] falls into private or reserved ranges.
 * 
 * @param {number[]} parts
 * @returns {boolean}
 */
function isPrivateIPv4Parts(parts) {
  if (!parts || parts.length !== 4 || parts.some(n => isNaN(n) || n < 0 || n > 255)) {
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
 * Parses an IPv6 address string into 8 16-bit numeric words.
 * Handles abbreviated '::' syntax and embedded IPv4 notations.
 * 
 * @param {string} rawIp
 * @returns {number[]|null}
 */
function parseIPv6Words(rawIp) {
  let clean = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const colonParts = clean.split('::');
  if (colonParts.length > 2) return null;

  function parseSegment(seg) {
    if (!seg) return [];
    const tokens = seg.split(':');
    const words = [];
    for (const tok of tokens) {
      if (tok.includes('.')) {
        const v4 = tok.split('.').map(Number);
        if (v4.length !== 4 || v4.some(n => isNaN(n) || n < 0 || n > 255)) return null;
        words.push((v4[0] << 8) | v4[1]);
        words.push((v4[2] << 8) | v4[3]);
      } else {
        const n = parseInt(tok, 16);
        if (isNaN(n) || n < 0 || n > 0xffff) return null;
        words.push(n);
      }
    }
    return words;
  }

  const left = parseSegment(colonParts[0]);
  if (!left) return null;

  if (colonParts.length === 2) {
    const right = parseSegment(colonParts[1]);
    if (!right) return null;
    const missing = 8 - (left.length + right.length);
    if (missing < 0) return null;
    return [...left, ...new Array(missing).fill(0), ...right];
  }

  return left.length === 8 ? left : null;
}

/**
 * Checks whether an IP address belongs to private, loopback, link-local,
 * multicast, carrier-grade NAT, or reserved ranges.
 * Supports IPv4, IPv6, IPv4-mapped IPv6 (dotted and hex), 6to4, NAT64, and ULA.
 * 
 * @param {string} rawIp - IPv4 or IPv6 address string
 * @returns {boolean} True if the IP is private or reserved
 */
function isPrivateIp(rawIp) {
  if (!rawIp || typeof rawIp !== 'string') return true;

  const ip = rawIp.trim().replace(/^\[|\]$/g, '');

  // 1. Standard IPv4 validation
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    return isPrivateIPv4Parts(parts);
  }

  // 2. IPv6 and encapsulated IP validation
  if (net.isIPv6(ip)) {
    const words = parseIPv6Words(ip);
    if (!words) return true; // Malformed IPv6 treated as unsafe

    // Loopback (::1)
    if (words.slice(0, 7).every(w => w === 0) && words[7] === 1) {
      return true;
    }

    // Unspecified (::)
    if (words.every(w => w === 0)) {
      return true;
    }

    // IPv4-mapped IPv6 (::ffff:0:0/96, e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
    if (words.slice(0, 5).every(w => w === 0) && words[5] === 0xffff) {
      const v4Parts = [
        (words[6] >> 8) & 0xff,
        words[6] & 0xff,
        (words[7] >> 8) & 0xff,
        words[7] & 0xff,
      ];
      return isPrivateIPv4Parts(v4Parts);
    }

    // IPv4-compatible IPv6 (::0:0/96, deprecated)
    if (words.slice(0, 6).every(w => w === 0) && !(words[6] === 0 && words[7] === 1)) {
      const v4Parts = [
        (words[6] >> 8) & 0xff,
        words[6] & 0xff,
        (words[7] >> 8) & 0xff,
        words[7] & 0xff,
      ];
      return isPrivateIPv4Parts(v4Parts);
    }

    // NAT64 Well-Known Prefix (64:ff9b::/96)
    if (words[0] === 0x0064 && words[1] === 0xff9b && words.slice(2, 6).every(w => w === 0)) {
      const v4Parts = [
        (words[6] >> 8) & 0xff,
        words[6] & 0xff,
        (words[7] >> 8) & 0xff,
        words[7] & 0xff,
      ];
      return isPrivateIPv4Parts(v4Parts);
    }

    // 6to4 prefix (2002::/16) - encapsulates IPv4 in words 1 and 2
    if (words[0] === 0x2002) {
      const v4Parts = [
        (words[1] >> 8) & 0xff,
        words[1] & 0xff,
        (words[2] >> 8) & 0xff,
        words[2] & 0xff,
      ];
      return isPrivateIPv4Parts(v4Parts);
    }

    // Unique Local Addresses (fc00::/7)
    if ((words[0] & 0xfe00) === 0xfc00) return true;

    // Link-local unicast (fe80::/10)
    if ((words[0] & 0xffc0) === 0xfe80) return true;

    // Site-local unicast (fec0::/10, deprecated)
    if ((words[0] & 0xffc0) === 0xfec0) return true;

    // Multicast (ff00::/8)
    if ((words[0] & 0xff00) === 0xff00) return true;

    // Documentation (2001:db8::/32)
    if (words[0] === 0x2001 && words[1] === 0x0db8) return true;

    // Discard-only prefix (100::/64)
    if (words[0] === 0x0100 && words[1] === 0 && words[2] === 0 && words[3] === 0) return true;

    // Benchmarking (2001:2::/48)
    if (words[0] === 0x2001 && words[1] === 0x0002) return true;

    return false;
  }

  return true;
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
