import * as React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import App from '../App';
import { AuthedRoute, OrganizationRoute, OnboardingRoute, RoleRoute } from './guards';
import { AuthGate } from '../components/AuthGate';
import { OrganizationOnboarding } from '../components/OrganizationOnboarding';

import { AdvancedSearchPage, InventoryPage, SettingsPage, VaultPage, TerminalPage } from '../pages/WorkspacePages';
import { DashboardPage } from '../pages/DashboardPage';
import { LandingPage } from '../pages/LandingPage';
import { WorkspaceGatewayPage } from '../pages/WorkspaceGatewayPage';
import { OrganizationCreatePage } from '../pages/OrganizationCreatePage';
import { InvitationsPage, InvitationByTokenPage } from '../pages/InvitationPages';
import { OrganizationLayout } from '../components/organization/OrganizationLayout';
import { OrganizationProfilePage } from '../components/organization/OrganizationProfilePage';
import { OrganizationSettingsPage } from '../components/organization/OrganizationSettingsPage';
import { DiscoveryPage } from '../pages/DiscoveryPage';
import { RfpListPage, RfpDetailPage } from '../pages/RfpPages';
import { VaultSecurityPage } from '../pages/VaultSecurityPage';
import { AuthCallbackPage } from '../pages/AuthCallbackPage';

import { AdminLayout } from '../components/admin/AdminLayout';
import { AdminOverviewPage } from '../components/admin/AdminOverviewPage';
import { AdminUsersPage } from '../components/admin/AdminUsersPage';
import { AdminCompanyPage } from '../components/admin/AdminCompanyPage';
import { AdminInventoryPage } from '../components/admin/AdminInventoryPage';
import { AdminCompliancePage } from '../components/admin/AdminCompliancePage';
import { AdminDiscoveryPage } from '../components/admin/AdminDiscoveryPage';
import { AdminAuditPage } from '../components/admin/AdminAuditPage';

/**
 * Route table.
 *
 * Three layers of gate, each a real requirement rather than a decoration:
 *   AuthedRoute        — there is a Supabase session
 *   OrganizationRoute  — that session resolves to an active organisation
 *   RoleRoute          — the member's role covers this area
 *
 * The server re-checks all three on every request; these only decide what is
 * worth rendering.
 */
export const AppRoutes: React.FC = () => (
  <Routes>
    {/* ── Public ──────────────────────────────────────────────────── */}
    <Route path="/" element={<LandingPage />} />
    <Route path="/signin" element={<AuthGate />} />
    {/* Where Supabase returns after Google. Must be registered as a redirect
        URL in the Supabase dashboard or the provider refuses the round trip. */}
    <Route path="/auth/callback" element={<AuthCallbackPage />} />

    {/* ── Signed in, organisation NOT yet required ─────────────────────
        These are exactly what a user reaches when they belong to nothing.
        Behind OrganizationRoute, creating a first organisation would require
        already having one. */}
    <Route element={<AuthedRoute />}>
      <Route path="/workspace" element={<WorkspaceGatewayPage />} />
      <Route path="/organization/create" element={<OrganizationCreatePage />} />
      <Route path="/organization/join" element={<InvitationsPage />} />
      <Route path="/invitations" element={<InvitationsPage />} />
      <Route path="/invitations/:token" element={<InvitationByTokenPage />} />

      <Route element={<OnboardingRoute />}>
        <Route path="/onboarding" element={<OrganizationOnboarding />} />
      </Route>

      {/* Signed in, with an active organisation */}
      <Route element={<OrganizationRoute />}>
        <Route element={<App />}>
          <Route path="/dashboard" element={<DashboardPage />} />

          <Route path="/discovery" element={<DiscoveryPage />} />
          <Route path="/discovery/advanced" element={<AdvancedSearchPage />} />

          <Route path="/rfps" element={<RfpListPage />} />
          <Route path="/rfps/:analysisId" element={<RfpDetailPage />} />

          <Route path="/inventory" element={<InventoryPage />} />
          <Route path="/vault" element={<VaultPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/settings/security" element={<VaultSecurityPage />} />
          <Route path="/logs" element={<TerminalPage />} />

          {/* Organisation: identity and configuration. Any member may read
              it; the write controls inside are role-gated. */}
          <Route path="/organization" element={<OrganizationLayout />}>
            <Route index element={<OrganizationProfilePage />} />
            <Route path="settings" element={<OrganizationSettingsPage />} />
            {/* Managing people is administrative, so these reuse the admin
                screen behind the same role check. */}
            <Route element={<RoleRoute permission="members:manage" />}>
              <Route path="members" element={<AdminUsersPage />} />
              <Route path="invitations" element={<AdminUsersPage />} />
            </Route>
          </Route>

          {/* Admin — owner and admin only */}
          <Route element={<RoleRoute permission="members:manage" />}>
            <Route path="/admin" element={<AdminLayout />}>
              <Route index element={<AdminOverviewPage />} />
              <Route path="company" element={<AdminCompanyPage />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route path="inventory" element={<AdminInventoryPage />} />
              <Route path="compliance" element={<AdminCompliancePage />} />
              <Route path="discovery" element={<AdminDiscoveryPage />} />
              <Route path="audit" element={<AdminAuditPage />} />
            </Route>
          </Route>
        </Route>
      </Route>
    </Route>

    {/* Unknown path: the gateway decides where the user actually belongs,
        rather than assuming a dashboard they may not be able to open. */}
    <Route path="*" element={<Navigate to="/workspace" replace />} />
  </Routes>
);
