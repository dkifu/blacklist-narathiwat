import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import './App.css'
import AddVehicle from './pages/AddVehicle'
import VehicleList from './pages/VehicleList'
import VehicleDetail from './pages/VehicleDetail'
import Settings from './pages/Settings'
import Users from './pages/Users'
import Dashboard from './pages/Dashboard'
import ActivityLog from './pages/ActivityLog'


function App() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)

  const [loading, setLoading] = useState(true)
  const [loginLoading, setLoginLoading] = useState(false)
  const [message, setMessage] = useState('')

  const [currentPage, setCurrentPage] = useState('dashboard')
  const [selectedVehicleId, setSelectedVehicleId] = useState(null)

  useEffect(() => {
    const start = async () => {
      const { data } = await supabase.auth.getSession()
      setSession(data.session)

      if (data.session) {
        await loadProfile(data.session.user.id)
      }

      setLoading(false)
    }

    start()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession)

      if (newSession) {
        await loadProfile(newSession.user.id)
      } else {
        setProfile(null)
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const loadProfile = async (userId) => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()

    if (error) {
      console.error('Profile error:', error)
      setProfile(null)
      return
    }

    if (!data.active) {
      await supabase.auth.signOut()
      setMessage('บัญชีนี้ถูกระงับการใช้งาน')
      return
    }

    setProfile(data)
  }

  const handleLogin = async (e) => {
    e.preventDefault()

    setLoginLoading(true)
    setMessage('')

    const { data, error } =
      await supabase.functions.invoke(
        'username-login',
        {
          body: {
            username: username.trim(),
            password,
          },
        }
      )

    if (error) {
      console.error(error)

      let errorMessage =
        'Username หรือ Password ไม่ถูกต้อง'

      try {
        const errorBody =
          await error.context?.json()

        if (errorBody?.error) {
          errorMessage = errorBody.error
        }
      } catch (parseError) {
        console.error(
          'อ่านรายละเอียด Login Error ไม่สำเร็จ',
          parseError
        )
      }

      setMessage(errorMessage)
      setLoginLoading(false)
      return
    }

    if (
      !data?.access_token ||
      !data?.refresh_token
    ) {
      setMessage(
        data?.error ||
        'ไม่สามารถเข้าสู่ระบบได้'
      )

      setLoginLoading(false)
      return
    }

    const {
      error: sessionError,
    } = await supabase.auth.setSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
    })

    if (sessionError) {
      console.error(sessionError)
      setMessage(
        'ไม่สามารถสร้าง Session ได้'
      )

      setLoginLoading(false)
      return
    }

    setLoginLoading(false)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  if (loading) {
    return (
      <div className="loading-page">
        <div className="loader"></div>
        <p>กำลังโหลดระบบ...</p>
      </div>
    )
  }

  const pageTitle = {
    dashboard: 'Dashboard',
    vehicles: 'รถ Blacklist',
    addVehicle: 'เพิ่มรถ Blacklist',
    vehicleDetail: 'รายละเอียดรถ',
    editVehicle: 'แก้ไขข้อมูลรถ',
    users: 'ผู้ใช้งาน',
    activityLog: 'Activity Log',
    settings: 'ตั้งค่าระบบ',
  }[currentPage] || 'Blacklist Narathiwat'

  // =========================
  // DASHBOARD
  // =========================

  if (session) {
    return (
      <div className="app-layout">

        <aside className="sidebar">

          <div className="sidebar-brand">
            <div className="sidebar-logo">B</div>

            <div>
              <h2>BLACKLIST</h2>
              <span>NARATHIWAT</span>
            </div>
          </div>

          <nav className="sidebar-menu">

            <button
              className={`menu-item ${currentPage === 'dashboard' ? 'active' : ''}`}
              onClick={() => setCurrentPage('dashboard')}
            >
              Dashboard
            </button>

            <button
              className={`menu-item ${currentPage === 'vehicles' ? 'active' : ''}`}
              onClick={() => setCurrentPage('vehicles')}
            >
              รถ Blacklist
            </button>

            <button
              className={`menu-item ${currentPage === 'addVehicle' ? 'active' : ''}`}
              onClick={() => setCurrentPage('addVehicle')}
            >
              เพิ่มรถ
            </button>

            {(profile?.role === 'admin' ||
              profile?.role === 'center') && (

              <button
                className={`menu-item ${
                  currentPage === 'users' ? 'active' : ''
                }`}
                onClick={() => setCurrentPage('users')}
              >
                ผู้ใช้งาน
              </button>

            )}

            {profile?.role === 'admin' && (
              <button
                className={`menu-item ${
                  currentPage === 'activityLog' ? 'active' : ''
                }`}
                onClick={() => setCurrentPage('activityLog')}
              >
                Activity Log
              </button>
            )}

            {(profile?.role === 'admin' ||
              profile?.role === 'center') && (
              <button
                className={`menu-item ${
                  currentPage === 'settings' ? 'active' : ''
                }`}
                onClick={() => setCurrentPage('settings')}
              >
                ⚙ ตั้งค่าระบบ
              </button>
            )}

          </nav>

          <div className="sidebar-bottom">
            <button
              className="logout-button"
              onClick={handleLogout}
            >
              ออกจากระบบ
            </button>
          </div>

        </aside>

        <main className="main-content">

          <header className="topbar">

            <div>
              <h1>{pageTitle}</h1>
              <p>Vehicle Blacklist Management System</p>
            </div>

            <div className="user-info">

              <div className="user-avatar">
                {profile?.full_name?.charAt(0)?.toUpperCase() || 'U'}
              </div>

              <div>
                <strong>
                  {profile?.full_name || session.user.email}
                </strong>

                <span>
                  {profile?.agency || '-'}
                </span>
              </div>

              <div className="role-badge">
                {profile?.role?.toUpperCase()}
              </div>

            </div>

          </header>

          <section className="dashboard-body">

            {currentPage === 'addVehicle' ? (

              <AddVehicle
                profile={profile}
              />

            ) : currentPage === 'editVehicle' ? (

              <AddVehicle
                vehicleId={selectedVehicleId}
                profile={profile}

                onCancel={() => {
                  setCurrentPage('vehicleDetail')
                }}

                onSaved={() => {
                  setCurrentPage('vehicleDetail')
                }}
              />

            ) : currentPage === 'vehicles' ? (

              <VehicleList
                onViewDetails={(vehicleId) => {

                  setSelectedVehicleId(vehicleId)

                  setCurrentPage('vehicleDetail')

                }}
              />

            ) : currentPage === 'vehicleDetail' ? (

              <VehicleDetail
                vehicleId={selectedVehicleId}
                profile={profile}

                onBack={() => {
                  setCurrentPage('vehicles')
                }}

                onEdit={(vehicleId) => {
                  setSelectedVehicleId(vehicleId)
                  setCurrentPage('editVehicle')
                }}

                onDeleted={() => {
                  setSelectedVehicleId(null)
                  setCurrentPage('vehicles')
                }}
              />

            ) : currentPage === 'users' ? (

              <Users profile={profile} />

            ) : currentPage === 'activityLog' ? (

              <ActivityLog profile={profile} />

            ) : currentPage === 'settings' ? (

              <Settings profile={profile} />

            ) : (

              <Dashboard
                profile={profile}

                onViewDetails={(vehicleId) => {
                  setSelectedVehicleId(vehicleId)
                  setCurrentPage('vehicleDetail')
                }}
              />

            )}

          </section>

        </main>

      </div>
    )
  }

  // =========================
  // LOGIN
  // =========================

  return (
    <div className="login-page">

      <div className="login-panel">

        <div className="brand">

          <div className="brand-icon">
            B
          </div>

          <h1>BLACKLIST</h1>
          <h2>NARATHIWAT</h2>

          <p>
            Vehicle Blacklist Management System
          </p>

        </div>

        <form
          className="login-form"
          onSubmit={handleLogin}
        >

          <div className="form-group">

            <label>Username</label>

            <input
              type="text"
              placeholder="กรอก Username"
              value={username}
              onChange={(e) =>
                setUsername(e.target.value)
              }
              autoComplete="username"
              required
            />

          </div>

          <div className="form-group">

            <label>Password</label>

            <input
              type="password"
              placeholder="กรอก Password"
              value={password}
              onChange={(e) =>
                setPassword(e.target.value)
              }
              required
            />

          </div>

          {message && (
            <div className="error-message">
              {message}
            </div>
          )}

          <button
            type="submit"
            className="login-button"
            disabled={loginLoading}
          >

            {loginLoading
              ? 'กำลังเข้าสู่ระบบ...'
              : 'เข้าสู่ระบบ'}

          </button>

        </form>

        <div className="login-footer">
          Authorized Personnel Only
        </div>

      </div>

    </div>
  )
}

export default App