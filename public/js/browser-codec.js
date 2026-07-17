/**
 * Diamond Proxy - URL Codec (Shared between SW and Page)
 * Uses encodeURIComponent with % replaced by - for URL safety
 */

class URLCodec {
  static encode(url) {
    if (!url) return '';
    url = String(url);
    
    // If already encoded, return as is
    if (url.startsWith('/~/')) return url;
    
    try {
      const encoded = encodeURIComponent(url);
      return '/~/' + encoded.replace(/%/g, '-');
    } catch (e) {
      console.error('[URLCodec] Encode failed:', e);
      return '/~/' + encodeURIComponent(url).replace(/%/g, '-');
    }
  }

  static decode(encoded) {
    if (!encoded) return '';
    
    try {
      let path = encoded;
      
      // Strip leading slash
      if (path.startsWith('/')) path = path.substring(1);
      
      // Handle /~/ prefix
      if (path.startsWith('~/')) path = path.substring(2);
      else if (path.startsWith('~')) path = path.substring(1);
      
      // Restore % signs
      const withPercent = path.replace(/-/g, '%');
      
      // Decode
      return decodeURIComponent(withPercent);
    } catch (e) {
      console.error('[URLCodec] Decode failed for:', encoded.substring(0, 100), e);
      try {
        return decodeURIComponent(encoded.replace('/~/', ''));
      } catch (e2) {
        return '';
      }
    }
  }

  static isEncoded(str) {
    return str && (str.startsWith('/~/') || str.startsWith('~/'));
  }
}

// Expose globally
window.DiamondCodec = URLCodec;
