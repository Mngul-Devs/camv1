/**
 * ============================================================================
 * FRONTEND V6 — CamPark Parking Intelligence Platform
 * Full Architecture & Documentation Reference
 * ============================================================================
 *
 * Last updated: 2026-03-09
 *
 * ============================================================================
 * 1. PROJECT OVERVIEW
 * ============================================================================
 *
 * CamPark is a parking monitoring dashboard built with React + Tailwind CSS,
 * featuring a dark theme (GitHub/Supabase style), three-layer navigation
 * (top bar, mother sidebar, child sidebar), and FTP-based camera management.
 *
 * Tech Stack:
 *   - React 18.3.1
 *   - React Router 7.x (data mode, NOT react-router-dom)
 *   - Tailwind CSS v4
 *   - MapLibre GL JS (dark CARTO basemap)
 *   - @tanstack/react-table
 *   - Radix UI primitives (dialog, sheet, select, dropdown, etc.)
 *   - Recharts (metrics/charts)
 *   - Lucide React (icons)
 *   - Sonner (toasts)
 *   - Motion (animations)
 *
 * ============================================================================
 * 2. NAVIGATION ARCHITECTURE
 * ============================================================================
 *
 * Three-layer navigation:
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ TopBar — Project switcher (Supabase-style), clock, notifs  │
 *   ├──────┬──────────────────────────────────────────────────────┤
 *   │Mother│  Main Content Area (Outlet)                         │
 *   │Side  │                                                      │
 *   │bar   │  Pages render here via React Router <Outlet />       │
 *   │      │                                                      │
 *   │(icon │  Child sidebars can appear within specific pages     │
 *   │ nav) │  (e.g., Settings sub-navigation)                     │
 *   │      │                                                      │
 *   └──────┴──────────────────────────────────────────────────────┘
 *
 * TopBar Features:
 *   - Supabase-style project switcher dropdown
 *   - Search within projects
 *   - Status badges: PRODUCTION / PAUSED / DEVELOPMENT
 *   - Checkmark on selected project
 *   - Inline new project creation
 *   - Clock display
 *   - Notification bell with unread count
 *   - User avatar dropdown
 *
 * ============================================================================
 * 3. ROUTING
 * ============================================================================
 *
 * File: /src/app/routes.ts
 *
 * Sign-in flow: / (SignInPage) → /app (auto-select first project)
 * No organization layer — projects are top-level.
 *
 *   /                          → SignInPage
 *   /app                       → RootLayout (TopBar + MotherSidebar + Outlet)
 *     /app                     → DashboardPage (index)
 *     /app/projects            → ProjectsPage
 *     /app/sites               → SitesPage
 *     /app/devices             → DevicesPage (camera list)
 *     /app/devices/:deviceId   → DeviceDetailPage (individual camera dashboard)
 *     /app/metrics             → MetricsPage
 *     /app/logs                → LogsPage
 *     /app/api-console         → ApiConsolePage
 *     /app/alerts              → AlertsPage
 *     /app/settings            → SettingsPage
 *     /app/*                   → redirect to /app
 *   /*                         → redirect to /
 *
 * ============================================================================
 * 4. CONTEXT / STATE MANAGEMENT
 * ============================================================================
 *
 * File: /src/app/contexts/OrganizationContext.tsx
 * (Name kept for backward compat, but NO organization layer exists)
 *
 * Provides:
 *   - user: User | null
 *   - isAuthenticated: boolean
 *   - signIn(email, password): boolean
 *   - signOut(): void
 *   - projects: Project[]
 *   - selectedProject: Project | null
 *   - selectProject(project): void
 *   - createProject(name): Project
 *   - deleteProject(id): void
 *   - notifications: Notification[]
 *   - markNotificationRead(id): void
 *   - unreadCount: number
 *
 * Project interface includes:
 *   - id, name, status, region, regionFlag
 *   - diskUsedGB, sitesCount, camerasCount, camerasOnline
 *   - zonesCount, zonesFree, zonesOccupied, eventsLast24h
 *   - sites: SiteLocation[] (used by map)
 *
 * ============================================================================
 * 5. PAGE DESCRIPTIONS
 * ============================================================================
 *
 * 5.1 DASHBOARD (/app)
 *   - MapLibre GL JS map with dark CARTO basemap
 *   - Animated site markers color-coded by health status
 *   - Interactive popups with camera/occupancy details
 *   - Fleet health table
 *   - Slide-out site detail panel
 *   - Summary stat cards (sites, cameras, zones, events)
 *
 * 5.2 PROJECTS (/app/projects)
 *   - List all projects with status badges
 *   - Create/delete projects
 *   - Project cards with key metrics
 *
 * 5.3 SITES (/app/sites)
 *   - All sites for the selected project
 *   - Status indicators, camera counts, occupancy
 *
 * 5.4 DEVICES (/app/devices)
 *   - Camera management table (no remote management — FTP-based)
 *   - Columns: Device Name (+ brand subtitle), Status, Site, Protocol,
 *     Last Seen, Zones, Actions (download config, edit/view detail)
 *   - NO Model column (removed)
 *   - Filters: search, site dropdown, status tabs (All/Online/Stale/Offline)
 *   - "+ Add Camera" button opens right-side Sheet
 *   - Add Camera form fields:
 *       Camera ID* (unique identifier)
 *       Camera Name (friendly name)
 *       Site* (dropdown)
 *       Brand* (dropdown: Dahua, ViGi TP-Link)
 *       Protocol* (dropdown: FTP, LAPI_WS)
 *       FTP Username*
 *       FTP Password
 *     NO Model field (removed per requirement)
 *   - Clicking a row navigates to /app/devices/:deviceId
 *
 * 5.5 DEVICE DETAIL (/app/devices/:deviceId)
 *   - Individual camera dashboard
 *   - Breadcrumb: CamPark > Dashboard > Devices > [Device Name]
 *   - Header: device name, ID + brand info, status badge, Zone Editor button
 *   - 4 stat cards: Snapshots Today, Processed, Skipped, Detections Today
 *   - Left column (2/3):
 *       Snapshot Records table (filter: All/Processed/Skipped, pagination)
 *       Zone Events table (pagination)
 *   - Right column (1/3):
 *       Latest Snapshot (image placeholder)
 *       Device Info panel (Camera ID, Brand, Protocol, FTP User,
 *         Last Seen, Last Inference, Snapshots/1h, Zones)
 *       Health History (timestamped status transitions)
 *       Current Zone States (zone name + FREE/OCCUPIED badges)
 *
 * 5.6 METRICS (/app/metrics)
 *   - Charts and graphs using Recharts
 *   - Occupancy trends, camera health over time, detection rates
 *
 * 5.7 LOGS (/app/logs)
 *   - System event logs with filtering
 *   - Real-time log stream view
 *
 * 5.8 API CONSOLE (/app/api-console)
 *   - API endpoint explorer
 *   - Request/response testing
 *   - Webhook configuration
 *
 * 5.9 ALERTS (/app/alerts)
 *   - Alert rules configuration
 *   - Active alerts list
 *   - Alert history
 *
 * 5.10 SETTINGS (/app/settings)
 *   - Project settings
 *   - User preferences
 *   - Integration configurations
 *
 * ============================================================================
 * 6. DEVICE ARCHITECTURE (FTP-BASED)
 * ============================================================================
 *
 * Cameras are NOT managed remotely. Images arrive via FTP push from devices.
 *
 * Supported Brands:
 *   - Dahua (protocol: FTP)
 *   - ViGi / TP-Link (protocol: LAPI_WS)
 *
 * Device Data Model:
 *   interface Device {
 *     id: string;              // Internal ID (dev-xxx)
 *     cameraId: string;        // User-facing ID (CAM001)
 *     name: string;            // Friendly name
 *     site: string;            // Associated site
 *     brand: "dahua" | "vigi"; // Camera manufacturer
 *     protocol: "FTP" | "LAPI_WS"; // Communication protocol
 *     status: "online" | "stale" | "offline" | "unknown";
 *     lastSeen: string | null;
 *     zones: number;
 *     ftpUsername: string;
 *     snapshotsToday: number;
 *     processed: number;
 *     skipped: number;
 *     detectionsToday: number;
 *     snapshotsPerHour: number;
 *     lastInference: string | null;
 *     zoneStates: { name: string; state: "FREE" | "OCCUPIED" }[];
 *     healthHistory: { time: string; status: string }[];
 *   }
 *
 * Status Definitions:
 *   - ONLINE:  Received snapshot within expected interval
 *   - STALE:   Last snapshot > threshold but < offline threshold
 *   - OFFLINE: No snapshots for extended period
 *   - UNKNOWN: Newly added, no data yet
 *
 * ============================================================================
 * 7. FILE STRUCTURE
 * ============================================================================
 *
 * /src/app/
 *   App.tsx                          — Root component (RouterProvider + Toaster)
 *   routes.ts                        — React Router configuration
 *   frontendv6.tsx                   — THIS FILE (documentation)
 *
 * /src/app/contexts/
 *   OrganizationContext.tsx           — Global state (user, projects, notifs)
 *
 * /src/app/pages/
 *   SignInPage.tsx                    — Authentication page
 *   DashboardPage.tsx                — Main dashboard with map
 *   ProjectsPage.tsx                 — Project management
 *   SitesPage.tsx                    — Site listing
 *   DevicesPage.tsx                  — Camera/device list + add camera sheet
 *   DeviceDetailPage.tsx             — Individual device dashboard
 *   MetricsPage.tsx                  — Analytics & charts
 *   LogsPage.tsx                     — System logs
 *   ApiConsolePage.tsx               — API testing console
 *   AlertsPage.tsx                   — Alert management
 *   SettingsPage.tsx                 — App settings
 *
 * /src/app/components/
 *   SiteMap.tsx                       — MapLibre GL map component
 *
 * /src/app/components/layout/
 *   RootLayout.tsx                    — App shell (TopBar + Sidebar + Outlet)
 *   TopBar.tsx                        — Top navigation bar
 *   MotherSidebar.tsx                 — Main icon sidebar
 *
 * /src/app/components/ui/             — Radix-based UI primitives
 *   (badge, button, card, dialog, dropdown-menu, input, label,
 *    select, sheet, switch, table, tabs, etc.)
 *
 * /src/app/components/figma/
 *   ImageWithFallback.tsx             — Protected image component
 *
 * /src/styles/
 *   theme.css                         — Tailwind v4 theme tokens
 *   fonts.css                         — Font imports
 *
 * ============================================================================
 * 8. DESIGN SYSTEM
 * ============================================================================
 *
 * Color Palette (Dark Theme):
 *   Background:     #0a0a0b (shell), #0f1115 (content area)
 *   Card/Panel:     #1c2128
 *   Border:         #2a2f36
 *   Text Primary:   #e6edf3
 *   Text Secondary: #9da7b3
 *   Link/Accent:    #58a6ff
 *   Success:        #3fb950
 *   Warning:        #d29922
 *   Error:          #f85149
 *   Muted:          #8b949e
 *   Emerald CTA:    emerald-600 / emerald-700
 *
 * Input Fields:
 *   bg: #111113, border: #2a2f36, text: #e6edf3
 *   placeholder: #9da7b3
 *
 * Status Colors:
 *   ONLINE:    #3fb950 (green)
 *   STALE:     #d29922 (amber)
 *   OFFLINE:   #9da7b3 (gray)
 *   UNKNOWN:   #8b949e (muted gray)
 *   ERROR:     #f85149 (red)
 *
 * ============================================================================
 * 9. PACKAGES (ACTIVE)
 * ============================================================================
 *
 * Core:
 *   react, react-dom, react-router, tailwindcss v4
 *
 * UI:
 *   @radix-ui/* (dialog, select, dropdown-menu, sheet, tabs, etc.)
 *   lucide-react, sonner, class-variance-authority, clsx, tailwind-merge
 *
 * Data:
 *   @tanstack/react-table, recharts, date-fns
 *
 * Map:
 *   maplibre-gl (active — used for dashboard map)
 *
 * Animation:
 *   motion (Framer Motion successor)
 *
 * UNUSED (can be removed):
 *   mapbox-gl (replaced by maplibre-gl)
 *   next-themes (dark theme is hardcoded)
 *
 * ============================================================================
 * 10. FUTURE PAGES / FEATURES (OUTSIDE FIGMA)
 * ============================================================================
 *
 * The following pages may be added outside the Figma design system:
 *   - Zone Editor (per-device zone configuration tool)
 *   - User Management
 *   - Billing / Usage
 *   - Audit Trail
 *   - Webhook Logs
 *   - Integration Marketplace
 *
 * These should follow the same dark theme, use existing UI components,
 * and be added as new routes under /app/*.
 *
 * ============================================================================
 * END OF DOCUMENTATION
 * ============================================================================
 */

// This file is documentation-only. No runtime exports.
export {};
