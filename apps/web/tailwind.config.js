/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // MoltPit Brand Colors
        'pit-black': '#0A0A0A',
        'molt-orange': '#FF4500',
        'crypto-green': '#00D395',
        'blood-red': '#8B0000',
        'base-blue': '#0052FF',
        'deep-sea': '#001F3F',
        'chain-silver': '#C0C0C0',
        'shell-ivory': '#FFF8DC',
        'victory-gold': '#FFD700',
        'usdc-blue': '#2775CA',
        'danger-crimson': '#DC143C',
        'legendary-purple': '#8A2BE2',
        // Legacy support
        moltpit: {
          orange: '#FF4500',
          green: '#00D395',
          dark: '#0A0A0A',
          darker: '#050505',
        },
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'slide-up': 'slide-up 0.3s ease-out',
        'claw-clash': 'claw-clash 0.5s ease-in-out',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(255, 69, 0, 0.5)' },
          '50%': { boxShadow: '0 0 40px rgba(0, 211, 149, 0.8)' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'claw-clash': {
          '0%, 100%': { transform: 'scale(1)' },
          '50%': { transform: 'scale(1.1)' },
        },
      },
    },
  },
  plugins: [],
};
