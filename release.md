## 🚀 New Features
- **AMOLED Dark Mode**: Completely overhauled the popup UI with pure black `#000000` backgrounds, elevated charcoal components, and high-contrast neon accents.
- **Hardware-Accelerated Micro-interactions**: Added smooth hover-lifts, scale compressions, and bezier-curved focus rings that make the interface feel deeply tactile and alive.

## 🐛 Bug Fixes
- **Native OS Dropdown Glitches**: Stripped aggressive `transform: translateY/scale()` rules from native OS `<select>` elements and their children, completely resolving severe coordinate drift and repaint stuttering.
- **Bidirectional Typography Support**: Maintained and verified pixel-perfect LTR/RTL caret positioning and `<select>` padding overrides for our custom stroke-based SVG chevrons.

## ⚡ Performance Improvements
- **Scoped CSS Transitions**: Migrated heavy `transition: all` rules on complex dropdown elements to strictly scoped paint-only properties (`box-shadow`, `border-color`, `background-color`). This drastically cuts down on forced synchronous layouts by the browser's rendering engine.
