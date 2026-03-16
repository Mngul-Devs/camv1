import { createBrowserRouter, redirect } from "react-router";
import { SignInPage } from "./pages/SignInPage";
import { RootLayout } from "./components/layout/RootLayout";
import { ProjectLayout } from "./components/layout/ProjectLayout";
import { SystemLayout } from "./components/layout/SystemLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { SitesPage } from "./pages/SitesPage";
import { DevicesPage } from "./pages/DevicesPage";
import { DeviceDetailPage } from "./pages/DeviceDetailPage";
import { MetricsPage } from "./pages/MetricsPage";
import { LogsPage } from "./pages/LogsPage";
import { PushConsolePage } from "./pages/PushConsole/PushConsolePage";
import { AlertsPage } from "./pages/AlertsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ZonesPage } from "./pages/ZonesPage";
import { UsersPage } from "./pages/UsersPage";
import { SystemPage } from "./pages/SystemPage";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: SignInPage,
  },
  {
    path: "/app",
    Component: RootLayout,
    children: [
      { index: true, Component: ProjectsPage },
      {
        path: "system",
        Component: SystemLayout,
        children: [
          { index: true, Component: SystemPage },
        ],
      },
      {
        path: "project/:projectId",
        Component: ProjectLayout,
        children: [
          { index: true, loader: () => redirect("dashboard") },
          { path: "dashboard", Component: DashboardPage },
          { path: "sites", Component: SitesPage },
          { path: "devices", Component: DevicesPage },
          { path: "devices/:deviceId", Component: DeviceDetailPage },
          { path: "metrics", Component: MetricsPage },
          { path: "logs", Component: LogsPage },
          { path: "push-console", Component: PushConsolePage },
          { path: "alerts", Component: AlertsPage },
          { path: "settings", Component: SettingsPage },
          { path: "zones", Component: ZonesPage },
          { path: "users", Component: UsersPage },
        ],
      },
      { path: "*", loader: () => redirect("/app") },
    ],
  },
  {
    path: "*",
    loader: () => redirect("/"),
  },
]);