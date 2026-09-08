import { HashRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import ChangePassword from './pages/ChangePassword'
import Dashboard from './pages/Dashboard'
import MyLogs from './pages/driver/MyLogs'
import LogEditor from './pages/driver/LogEditor'
import Approvals from './pages/manager/Approvals'
import Imports from './pages/admin/Imports'
import Journals from './pages/admin/Journals'
import Payroll from './pages/admin/Payroll'
import Fleet from './pages/admin/Fleet'
import Admin from './pages/admin/Admin'
import Recon from './pages/admin/Recon'

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/my-logs" element={<MyLogs />} />
            <Route path="/logs/:id" element={<LogEditor />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/approvals/:id" element={<LogEditor readOnly />} />
            <Route path="/imports/*" element={<Imports />} />
            <Route path="/journals" element={<Journals />} />
            <Route path="/recon" element={<Recon />} />
            <Route path="/payroll/*" element={<Payroll />} />
            <Route path="/fleet/*" element={<Fleet />} />
            <Route path="/admin/*" element={<Admin />} />
            <Route path="/change-password" element={<ChangePassword />} />
          </Route>
        </Routes>
      </HashRouter>
    </AuthProvider>
  )
}
