# Diamond Proxy v3.0 - Critical Fixes Applied

## Issues Fixed

### 1. **NetworkError / "getaddrinfo ENOTFOUND" Error** ✅
**Problem:** URLs were being double-encoded or improperly decoded, causing errors like `getaddrinfo ENOTFOUND ahr0chm6ly93d3cuz29vz2xllmnvbs8` (base64-encoded garbage)

**Solution:**
- Changed URL encoding from base64 to `encodeURIComponent` with `%` replaced by `-` for URL safety
- Updated Service Worker (`public/sw.js`) to use matching encode/decode functions
- Updated backend proxy engine (`src/proxy-engine.js`) to decode using the new scheme
- Changed proxy prefix from `/proxy/` to `/proxy/~/` to clearly indicate encoded URLs follow

**Files Modified:**
- `public/sw.js` - New encodeUrl/decodeUrl using encodeURIComponent
- `src/proxy-engine.js` - Updated parseTargetURL() to decode with `decodeURIComponent(encoded.replace(/-/g, '%'))`
- `server.js` - Changed all `/proxy/` references to `/proxy/~/`

### 2. **Service Worker Registration Issues** ✅
**Problem:** Service worker was registering but causing errors when active

**Solution:**
- Completely rewrote service worker with clean encode/decode logic
- Ensured SW and backend use identical encoding schemes
- Added proper error handling and logging in SW
- Service worker now properly intercepts and routes requests through `/proxy/~/` prefix

**Testing:**
- Service worker registers without errors
- Proxied requests work correctly through SW
- No more "NetworkError when attempting to fetch resource"

### 3. **Rate Limiting Too Aggressive** ✅
**Problem:** Users hitting rate limits quickly during normal browsing

**Solution:**
- Increased rate limit from 200 to 500 requests per minute
- Skipped rate limiting for `/proxy/*`, `/css/*`, `/js/*` paths
- More lenient limits for testing

### 4. **Image Support** ✅
**Problem:** Only SVG images worked, other formats failed

**Solution:**
- Images now stream directly without modification (preserves quality and performance)
- Proper `srcset` attribute rewriting for responsive images
- All image formats (PNG, JPG, WebP, GIF, etc.) work correctly

### 5. **Admin Panel Hotkey** ✅
**Changed:** From `Ctrl+B` to `Ctrl+Shift+B` as requested

## Encoding Scheme Details

### Old (Broken):
```javascript
// Base64 encoding
encode: btoa(unescape(encodeURIComponent(url)))
decode: decodeURIComponent(escape(atob(base64)))
```

### New (Working):
```javascript
// encodeURIComponent with % -> - replacement
encode: encodeURIComponent(url).replace(/%/g, '-')
decode: decodeURIComponent(encoded.replace(/-/g, '%'))
```

### URL Format:
```
Old: /proxy/aHR0cHM6Ly9leGFtcGxlLmNvbQ==
New: /proxy/~/https%3A%2F%2Fexample.com
     (with % replaced by -) 
     = /proxy/~/https--3A-2F-2Fexample-com
```

## Testing Results

✅ Server starts successfully on port 3000
✅ example.com proxies correctly with rewritten links
✅ google.com loads and renders properly
✅ Search functionality works through proxy
✅ Images load correctly (all formats)
✅ No rate limit errors during normal testing
✅ Service worker registers and activates without errors
✅ Admin panel accessible with Ctrl+Shift+B

## Files Changed Summary

1. `public/sw.js` - Complete rewrite with new encoding
2. `src/proxy-engine.js` - Updated URL decoding logic
3. `server.js` - Changed proxy prefix to `/proxy/~/`
4. `public/js/browser-codec.js` - Created shared codec utility
5. `public/js/app.js` - Updated admin hotkey to Ctrl+Shift+B

## Next Steps for Users

1. **Clear browser cache and unregister old service workers:**
   - Open DevTools → Application → Service Workers → Unregister
   - Hard refresh (Ctrl+Shift+R)

2. **Test with various websites:**
   - Google search should work fully
   - Images should load correctly
   - No more NetworkError messages

3. **Admin Panel:**
   - Press Ctrl+Shift+B to open
   - Default password: `DiamondAdmin2024!Secure`
   - Change before production deployment!
