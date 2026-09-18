import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import ChangePassword from './pages/ChangePassword'
import Dashboard from './pages/Dashboard'
import MyLogs from './pages/driver/MyLogs'
import LogEditor from './pages/driver/LogEditor'
import Approvals from './pages/manager/Approvals'
import BranchVehicles from './pages/manager/BranchVehicles'
import Travellers from './pages/admin/Travellers'
import Imports from './pages/admin/Imports'
import Journals from './pages/admin/Journals'
import Payroll from './pages/admin/Payroll'
import Fleet from './pages/admin/Fleet'
import Admin from './pages/admin/Admin'
import Recon from './pages/admin/Recon'

/** Landing page: admins get the dashboard, everyone else goes straight to My Travel Logs */
function Home() { const { canViewAll, loading } = useAuth(); if (loading) return null; return canViewAll ? <Dashboard /> : <Navigate to="/my-logs" replace /> }
function AdminOnly({ children }: { children: ReactNode }) { const { isAdmin, loading } = useAuth(); if (loading) return null; return isAdmin ? <>{children}</> : <Navigate to="/my-logs" replace /> }
function ManagerOnly({ children }: { children: ReactNode }) { const { isManager, loading } = useAuth(); if (loading) return null; return isManager ? <>{children}</> : <Navigate to="/my-logs" replace /> }

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Home />} />
            <Route path="/my-logs" element={<MyLogs />} />
            <Route path="/logs/:id" element={<LogEditor />} />
            <Route path="/approvals" element={<ManagerOnly><Approvals /></ManagerOnly>} />
            <Route path="/branch" element={<BranchVehicles />} />
            <Route path="/travellers" element={<AdminOnly><Travellers /></AdminOnly>} />
            <Route path="/approvals/:id" element={<ManagerOnly><LogEditor readOnly /></ManagerOnly>} />
            <Route path="/imports/*" element={<AdminOnly><Imports /></AdminOnly>} />
            <Route path="/journals" element={<AdminOnly><Journals /></AdminOnly>} />
            <Route path="/recon" element={<AdminOnly><Recon /></AdminOnly>} />
            <Route path="/payroll/*" element={<AdminOnly><Payroll /></AdminOnly>} />
            <Route path="/fleet/*" element={<AdminOnly><Fleet /></AdminOnly>} />
            <Route path="/admin/*" element={<AdminOnly><Admin /></AdminOnly>} />
            <Route path="/change-password" element={<ChangePassword />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}
