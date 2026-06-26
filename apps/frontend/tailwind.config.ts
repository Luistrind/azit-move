import type { Config } from 'tailwindcss';

// Tokens do Doc 3 §10.7. Cores semânticas de status NÃO entram aqui — vivem em
// statusColors.ts (Regra 9: sem cor hardcoded; cor vem de statusColors.ts).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: '#001029',
        accent: '#FA8E0D',
        'app-bg': '#eef1f5',
      },
      fontFamily: {
        display: ['Outfit', 'system-ui', 'sans-serif'],
        body: ['Manrope', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '14px',
        modal: '18px',
      },
    },
  },
  plugins: [],
} satisfies Config;
