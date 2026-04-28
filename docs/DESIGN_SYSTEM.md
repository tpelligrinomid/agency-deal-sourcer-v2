# Design System Documentation
## Agency Profiles Application (Based on Deal Room by Aragon Holdings)

---

## 1. Brand Identity

### Logo & Branding
- **App Name Format**: "[App Name] by Aragon Holdings"
- **Typography Style**: Elegant, professional serif headings with clean sans-serif body text
- **Tone**: Professional, trustworthy, enterprise-grade

---

## 2. Color Palette

### Primary Colors (HSL Format)

#### Light Mode
```css
:root {
  /* Core Background & Foreground */
  --background: 0 0% 93%;           /* Light gray background #EDEDED */
  --foreground: 0 0% 9%;            /* Near-black text #171717 */

  /* Card & Popover Surfaces */
  --card: 0 0% 100%;                /* Pure white cards */
  --card-foreground: 0 0% 9%;
  --popover: 0 0% 100%;
  --popover-foreground: 0 0% 9%;

  /* Primary Brand Color - Green */
  --primary: 92 91% 38%;            /* Vibrant green #58B50B */
  --primary-foreground: 0 0% 100%;  /* White text on primary */

  /* Secondary */
  --secondary: 0 0% 98%;            /* Near-white #FAFAFA */
  --secondary-foreground: 0 0% 9%;

  /* Muted/Subdued Elements */
  --muted: 0 0% 96%;                /* Light gray #F5F5F5 */
  --muted-foreground: 0 0% 40%;     /* Medium gray text #666666 */

  /* Accent - Orange */
  --accent: 29 84% 57%;             /* Vibrant orange #ED8C34 */
  --accent-foreground: 0 0% 100%;

  /* Destructive/Error - Red */
  --destructive: 0 84% 60%;         /* Bright red #F04438 */
  --destructive-foreground: 0 0% 100%;

  /* Borders & Inputs */
  --border: 0 0% 85%;               /* Light gray border #D9D9D9 */
  --input: 0 0% 85%;
  --ring: 92 91% 38%;               /* Matches primary for focus rings */

  /* Border Radius */
  --radius: 0.5rem;                 /* 8px base radius */
}
```

#### Dark Mode
```css
.dark {
  --background: 0 0% 9%;            /* Near-black */
  --foreground: 0 0% 93%;           /* Light gray text */

  --card: 0 0% 12%;
  --card-foreground: 0 0% 93%;

  --popover: 0 0% 12%;
  --popover-foreground: 0 0% 93%;

  --primary: 92 91% 45%;            /* Slightly brighter green */
  --primary-foreground: 0 0% 100%;

  --secondary: 0 0% 15%;
  --secondary-foreground: 0 0% 93%;

  --muted: 0 0% 18%;
  --muted-foreground: 0 0% 60%;

  --accent: 29 84% 57%;             /* Same accent orange */
  --accent-foreground: 0 0% 100%;

  --destructive: 0 62% 50%;
  --destructive-foreground: 0 0% 100%;

  --border: 0 0% 20%;
  --input: 0 0% 20%;
  --ring: 92 91% 45%;
}
```

### Sidebar-Specific Colors
```css
:root {
  --sidebar-background: 0 0% 100%;          /* White sidebar */
  --sidebar-foreground: 0 0% 40%;           /* Muted text */
  --sidebar-primary: 92 91% 38%;            /* Green for active states */
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 0 0% 98%;               /* Hover background */
  --sidebar-accent-foreground: 0 0% 9%;
  --sidebar-border: 0 0% 90%;               /* Subtle dividers */
  --sidebar-ring: 92 91% 38%;
}
```

---

## 3. Typography

### Font Families
```css
fontFamily: {
  display: ["Playfair Display", "Georgia", "serif"],  /* Headings */
  sans: ["Inter", "system-ui", "sans-serif"],         /* Body text */
}
```

### Font Import (index.html or CSS)
```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Playfair+Display:wght@400;500;600;700&display=swap" rel="stylesheet">
```

### Heading Hierarchy
| Element | Font | Size | Weight | Usage |
|---------|------|------|--------|-------|
| H1 | Playfair Display | 2.25rem (36px) | 600 | Page titles |
| H2 | Playfair Display | 1.5rem (24px) | 600 | Section headers |
| H3 | Playfair Display | 1.25rem (20px) | 600 | Card titles |
| Body | Inter | 0.875rem (14px) | 400 | Paragraphs |
| Small | Inter | 0.75rem (12px) | 400 | Captions, metadata |
| Button | Inter | 0.875rem (14px) | 500 | Action labels |

### CSS Classes
```css
h1, h2, h3, h4, h5, h6 {
  @apply font-display;
}

body {
  @apply bg-background text-foreground font-sans antialiased;
}
```

---

## 4. Spacing System

### Base Units (Tailwind)
```
4px  = 1 unit   (p-1, m-1)
8px  = 2 units  (p-2, m-2)
12px = 3 units  (p-3, m-3)
16px = 4 units  (p-4, m-4)
24px = 6 units  (p-6, m-6)
32px = 8 units  (p-8, m-8)
48px = 12 units (p-12, m-12)
```

### Standard Patterns
| Context | Spacing | Tailwind Class |
|---------|---------|----------------|
| Page padding | 32px | `p-8` |
| Card padding | 24px | `p-6` |
| Card header | 24px bottom margin | `space-y-1.5 p-6` |
| Card content | 24px (no top) | `p-6 pt-0` |
| Section gaps | 24px | `space-y-6` |
| Button gaps | 8px | `gap-2` |
| Form field gaps | 16px | `space-y-4` |
| Sidebar width | 256px | `w-64` |
| Main content offset | 256px left | `ml-64` |

---

## 5. Border Radius

```css
--radius: 0.5rem;  /* 8px base */

borderRadius: {
  lg: "var(--radius)",           /* 8px - Cards, modals */
  md: "calc(var(--radius) - 2px)", /* 6px - Buttons */
  sm: "calc(var(--radius) - 4px)", /* 4px - Small elements */
  full: "9999px",                 /* Circular - Avatars, badges */
}
```

---

## 6. Shadows

```css
:root {
  --shadow-card: 0 2px 8px -2px rgba(0, 0, 0, 0.06), 
                 0 4px 16px -4px rgba(0, 0, 0, 0.08);
  
  --shadow-hover: 0 4px 12px -2px rgba(0, 0, 0, 0.1), 
                  0 8px 24px -4px rgba(0, 0, 0, 0.12);
}

/* Tailwind utilities */
.shadow-card { box-shadow: var(--shadow-card); }
.shadow-hover { box-shadow: var(--shadow-hover); }
```

---

## 7. Component Specifications

### Buttons

#### Variants
```tsx
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);
```

### Cards
```tsx
// Base card styling
<div className="rounded-lg border bg-card text-card-foreground shadow-sm">
  {/* Card Header */}
  <div className="flex flex-col space-y-1.5 p-6">
    <h3 className="text-2xl font-semibold leading-none tracking-tight font-display">
      Title
    </h3>
    <p className="text-sm text-muted-foreground">Description</p>
  </div>
  
  {/* Card Content */}
  <div className="p-6 pt-0">
    Content here
  </div>
  
  {/* Card Footer */}
  <div className="flex items-center p-6 pt-0">
    Footer actions
  </div>
</div>
```

### Badges
```tsx
const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground",
      },
    },
  }
);
```

### Inputs
```tsx
<input className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" />
```

### Avatars
```tsx
// Container
<div className="relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full">
  {/* Fallback with initials */}
  <div className="flex h-full w-full items-center justify-center rounded-full bg-primary">
    <span className="text-primary-foreground text-sm font-medium">AB</span>
  </div>
</div>
```

---

## 8. Layout Patterns

### Sidebar + Main Content Layout
```tsx
// App container
<div className="min-h-screen bg-background">
  {/* Fixed sidebar */}
  <aside className="w-64 bg-white border-r border-border h-screen flex flex-col fixed left-0 top-0">
    {/* Logo section */}
    <div className="p-6 border-b border-border">
      <h1 className="font-display text-xl text-foreground">App Name</h1>
      <p className="text-xs text-muted-foreground italic">by Aragon Holdings</p>
    </div>
    
    {/* Navigation */}
    <nav className="flex-1 py-4">
      {/* Nav items */}
    </nav>
    
    {/* User section */}
    <div className="p-6 border-t border-border">
      {/* User info + sign out */}
    </div>
  </aside>
  
  {/* Main content area */}
  <main className="ml-64 p-8 min-h-screen">
    {/* Page content */}
  </main>
</div>
```

### Navigation Item States
```tsx
// Active nav item
<a className="flex items-center gap-3 px-6 py-3 text-sm font-medium text-primary bg-card border-l-[3px] border-primary">
  <Icon className="h-5 w-5" />
  <span>Label</span>
</a>

// Inactive nav item
<a className="flex items-center gap-3 px-6 py-3 text-sm font-medium text-muted-foreground hover:bg-card hover:text-foreground transition-colors">
  <Icon className="h-5 w-5" />
  <span>Label</span>
</a>
```

### Page Header Pattern
```tsx
<div className="flex items-center justify-between mb-6">
  <div>
    <h1 className="font-display text-3xl text-foreground">Page Title</h1>
    <p className="text-muted-foreground mt-1">Page description</p>
  </div>
  <Button>
    <Plus className="h-4 w-4 mr-2" />
    Add New
  </Button>
</div>
```

### Card Grid Layout
```tsx
<div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
  {items.map(item => (
    <Card key={item.id}>
      {/* Card content */}
    </Card>
  ))}
</div>
```

---

## 9. Status Indicators

### Status Badge Colors
| Status | Background | Text | Usage |
|--------|------------|------|-------|
| Active/Success | `bg-primary/10` | `text-primary` | Active deals, completed |
| Warning | `bg-accent/10` | `text-accent` | Pending, on hold |
| Error/Flagged | `bg-destructive/10` | `text-destructive` | Issues, errors |
| Neutral | `bg-muted` | `text-muted-foreground` | Draft, inactive |

### Example Implementation
```tsx
const statusColors = {
  active: "bg-primary/10 text-primary",
  pending: "bg-accent/10 text-accent", 
  flagged: "bg-destructive/10 text-destructive",
  inactive: "bg-muted text-muted-foreground",
};
```

---

## 10. Icons

### Library
- **Lucide React** (`lucide-react`)
- Icon size: `h-4 w-4` (16px) for inline, `h-5 w-5` (20px) for navigation

### Common Icons Used
```tsx
import {
  LayoutDashboard,  // Dashboard/Overview
  Users,            // Team/People
  Settings,         // Settings
  LogOut,           // Sign out
  FileSignature,    // Documents/NDAs
  Plus,             // Add/Create
  Search,           // Search
  ChevronDown,      // Dropdowns
  AlertTriangle,    // Warnings
  Check,            // Success/Complete
  X,                // Close/Delete
  FileText,         // Documents
  Building2,        // Companies/Agencies
} from 'lucide-react';
```

---

## 11. Animations

### Tailwind Keyframes
```js
keyframes: {
  "accordion-down": {
    from: { height: "0" },
    to: { height: "var(--radix-accordion-content-height)" },
  },
  "accordion-up": {
    from: { height: "var(--radix-accordion-content-height)" },
    to: { height: "0" },
  },
  "fade-in": {
    from: { opacity: "0", transform: "translateY(10px)" },
    to: { opacity: "1", transform: "translateY(0)" },
  },
  "spin-slow": {
    from: { transform: "rotate(0deg)" },
    to: { transform: "rotate(360deg)" },
  },
},
animation: {
  "accordion-down": "accordion-down 0.2s ease-out",
  "accordion-up": "accordion-up 0.2s ease-out",
  "fade-in": "fade-in 0.3s ease-out",
  "spin-slow": "spin-slow 1s linear infinite",
},
```

### Common Transitions
```css
transition-colors  /* Color changes */
transition-all     /* All properties */
duration-200       /* 200ms timing */
ease-out           /* Easing function */
```

---

## 12. Form Patterns

### Standard Form Layout
```tsx
<form className="space-y-4">
  <div className="space-y-2">
    <Label htmlFor="field">Field Label</Label>
    <Input id="field" placeholder="Enter value..." />
    <p className="text-xs text-muted-foreground">Helper text</p>
  </div>
  
  <div className="flex justify-end gap-2">
    <Button variant="outline">Cancel</Button>
    <Button type="submit">Save</Button>
  </div>
</form>
```

### Search/Filter Bar
```tsx
<div className="flex items-center gap-4 mb-6">
  <div className="relative flex-1 max-w-md">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
    <Input className="pl-10" placeholder="Search..." />
  </div>
  <Select>
    <SelectTrigger className="w-40">
      <SelectValue placeholder="Filter" />
    </SelectTrigger>
    <SelectContent>
      {/* Options */}
    </SelectContent>
  </Select>
</div>
```

---

## 13. Tables

### Standard Table Styling
```tsx
<div className="rounded-lg border bg-card overflow-hidden">
  <Table>
    <TableHeader>
      <TableRow className="bg-muted/50">
        <TableHead className="font-medium">Column</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow className="hover:bg-muted/50">
        <TableCell>Data</TableCell>
      </TableRow>
    </TableBody>
  </Table>
</div>
```

---

## 14. Modals/Dialogs

### Standard Dialog
```tsx
<Dialog>
  <DialogContent className="sm:max-w-md">
    <DialogHeader>
      <DialogTitle className="font-display">Modal Title</DialogTitle>
      <DialogDescription>
        Description text here.
      </DialogDescription>
    </DialogHeader>
    
    <div className="py-4">
      {/* Content */}
    </div>
    
    <DialogFooter>
      <Button variant="outline">Cancel</Button>
      <Button>Confirm</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

---

## 15. Tabs

### Standard Tab Pattern
```tsx
<Tabs defaultValue="tab1">
  <TabsList className="grid w-full grid-cols-2 max-w-md">
    <TabsTrigger value="tab1" className="gap-2">
      <Icon className="h-4 w-4" />
      Tab 1
      <Badge variant="secondary" className="text-xs">5</Badge>
    </TabsTrigger>
    <TabsTrigger value="tab2" className="gap-2">
      Tab 2
    </TabsTrigger>
  </TabsList>
  
  <TabsContent value="tab1" className="mt-6">
    Content for tab 1
  </TabsContent>
</Tabs>
```

---

## 16. Empty States

```tsx
<div className="flex flex-col items-center justify-center py-12 text-center">
  <div className="rounded-full bg-muted p-4 mb-4">
    <FileText className="h-8 w-8 text-muted-foreground" />
  </div>
  <h3 className="font-medium text-lg mb-1">No items yet</h3>
  <p className="text-sm text-muted-foreground mb-4">
    Get started by creating your first item.
  </p>
  <Button>
    <Plus className="h-4 w-4 mr-2" />
    Add Item
  </Button>
</div>
```

---

## 17. Loading States

### Skeleton Loaders
```tsx
<div className="space-y-4">
  <Skeleton className="h-8 w-64" />
  <Skeleton className="h-4 w-full" />
  <Skeleton className="h-4 w-3/4" />
</div>
```

### Spinner
```tsx
<div className="flex items-center justify-center py-8">
  <Loader2 className="h-6 w-6 animate-spin text-primary" />
</div>
```

---

## 18. Alert/Banner Patterns

### Warning Banner
```tsx
<div className="flex items-center gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
  <AlertTriangle className="h-5 w-5 text-destructive flex-shrink-0" />
  <div>
    <p className="text-sm font-medium text-destructive">Attention Required</p>
    <p className="text-sm text-muted-foreground">Description here.</p>
  </div>
</div>
```

---

## 19. Dependencies

### Required Packages
```json
{
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.30.1",
    "@tanstack/react-query": "^5.83.0",
    "tailwindcss": "^3.x",
    "tailwindcss-animate": "^1.0.7",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.6.0",
    "lucide-react": "^0.462.0",
    "@radix-ui/react-dialog": "^1.1.14",
    "@radix-ui/react-dropdown-menu": "^2.1.15",
    "@radix-ui/react-tabs": "^1.1.12",
    "@radix-ui/react-avatar": "^1.1.10",
    "@radix-ui/react-select": "^2.2.5",
    "@radix-ui/react-tooltip": "^1.2.7",
    "sonner": "^1.7.4"
  }
}
```

### shadcn/ui Components Recommended
- Button, Card, Badge, Input, Label
- Dialog, Dropdown Menu, Select
- Tabs, Table, Avatar
- Tooltip, Skeleton, Separator
- Toast (via Sonner)

---

## 20. File Structure Recommendation

```
src/
├── components/
│   ├── ui/              # shadcn components
│   ├── Sidebar.tsx      # Main navigation
│   └── [feature]/       # Feature-specific components
├── contexts/
│   └── AuthContext.tsx
├── hooks/
│   └── use-toast.ts
├── lib/
│   ├── utils.ts         # cn() helper
│   └── api.ts           # API functions
├── pages/
│   ├── Login.tsx
│   └── [features].tsx
├── index.css            # CSS variables
├── App.tsx
└── main.tsx
```

---

## Quick Start Checklist

1. ☐ Install dependencies and configure Tailwind
2. ☐ Copy CSS variables to `index.css`
3. ☐ Update `tailwind.config.ts` with theme extensions
4. ☐ Add Google Fonts (Playfair Display + Inter)
5. ☐ Install shadcn/ui and configure components.json
6. ☐ Create Sidebar component with branding
7. ☐ Set up page layout with `ml-64 p-8` pattern
8. ☐ Apply design tokens to all components

---

*Generated from Deal Room by Aragon Holdings design system*
