---
description: Initialize MyMozhem project from scratch following the PRD. Sets up Vite, React, TypeScript, shadcn/ui, Supabase client, and project structure.
---

# Initialize MyMozhem Project

Set up the project from scratch following the PRD.

## Steps

1. **Read PRD thoroughly**: `docs/PRD.md`

2. **Initialize Vite + React + TypeScript**:
   ```bash
   pnpm create vite . --template react-ts
   pnpm install
   ```

3. **Install core dependencies**:
   ```bash
   pnpm add @supabase/supabase-js react-router-dom framer-motion qrcode.react
   pnpm add -D vitest @testing-library/react @testing-library/jest-dom jsdom
   ```

4. **Set up shadcn/ui**:
   ```bash
   pnpm add -D tailwindcss postcss autoprefixer
   npx tailwindcss init -p
   pnpm dlx shadcn@latest init
   ```

5. **Create project structure** as defined in PRD:
   ```
   src/
   ├── components/ui/
   ├── components/lottery/
   ├── components/admin/
   ├── components/room/
   ├── hooks/
   ├── lib/
   ├── plugins/games/
   ├── plugins/visualizations/
   ├── plugins/themes/
   ├── repositories/
   ├── i18n/
   ├── types/
   └── pages/
   ```

6. **Configure Tailwind** with theme CSS variables

7. **Create Supabase client** in `src/lib/supabase.ts`

8. **Set up i18n** with Russian translations

9. **Create basic routing** skeleton with react-router-dom

10. **Initialize plugin registry**

## Expected Output

- Working dev server (`pnpm dev`)
- All directories created
- Basic App component with router
- shadcn/ui configured
- i18n set up with Russian
- Empty but structured codebase ready for features
