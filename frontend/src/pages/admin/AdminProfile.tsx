import { useState } from 'react';
import { toast } from 'react-hot-toast';
import { useAuthStore } from '../../context/authStore';
import { adminApi } from '../../services/api';
import { Eye, EyeOff } from 'lucide-react';
import BackButton from '../../components/BackButton';

export default function AdminProfile() {
  const { admin, setAdmin } = useAuthStore();

  const initials = admin?.name
    ? admin.name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()
    : 'AD';

  const [name, setName]               = useState(admin?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword]         = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingName, setSavingName]   = useState(false);
  const [savingPw, setSavingPw]       = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew]         = useState(false);

  const handleSaveName = async () => {
    if (!name.trim()) { toast.error('Name cannot be empty'); return; }
    setSavingName(true);
    try {
      const { data } = await adminApi.updateProfile({ name: name.trim() });
      setAdmin(data.admin, localStorage.getItem('adminToken') || undefined);
      toast.success('Name updated');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Failed to update name');
    } finally { setSavingName(false); }
  };

  const handleChangePassword = async () => {
    if (!currentPassword) { toast.error('Enter current password'); return; }
    if (newPassword.length < 8) { toast.error('New password must be at least 8 characters'); return; }
    if (newPassword !== confirmPassword) { toast.error('Passwords do not match'); return; }
    setSavingPw(true);
    try {
      await adminApi.changePassword({ currentPassword, newPassword });
      toast.success('Password changed');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      toast.error(e.response?.data?.error || 'Failed to change password');
    } finally { setSavingPw(false); }
  };

  const inputSx: React.CSSProperties = {
    width: '100%', padding: '10px 14px', borderRadius: '10px',
    border: '1.5px solid #E5E7EB', fontSize: '14px', color: '#111827',
    outline: 'none', boxSizing: 'border-box', backgroundColor: 'white',
  };

  const disabledInputSx: React.CSSProperties = {
    ...inputSx,
    backgroundColor: '#F9FAFB',
    color: '#6B7280',
    cursor: 'not-allowed',
  };

  return (
    <div style={{ backgroundColor: '#F9FAFB', margin: '-24px', minHeight: 'calc(100vh - 52px)' }}>
      {/* Header */}
      <div style={{ backgroundColor: 'white', borderBottom: '1px solid #F3F4F6', padding: '20px 32px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <BackButton mt="0" />
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#111827', margin: 0 }}>My Profile</h1>
          <p style={{ fontSize: '13px', color: '#6B7280', margin: '4px 0 0' }}>Manage your personal details and password.</p>
        </div>
      </div>

      <div style={{ maxWidth: '640px', margin: '0 auto', padding: '28px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* Avatar + identity */}
        <div style={{ backgroundColor: 'white', borderRadius: '14px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: '18px' }}>
          <div style={{ width: '60px', height: '60px', borderRadius: '50%', backgroundColor: '#10B981', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 700, fontSize: '20px', flexShrink: 0 }}>
            {initials}
          </div>
          <div>
            <p style={{ fontSize: '18px', fontWeight: 700, color: '#111827', margin: 0 }}>{admin?.name || 'Admin'}</p>
            <p style={{ fontSize: '13px', color: '#6B7280', margin: '3px 0 0' }}>{admin?.email}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#059669', backgroundColor: '#D1FAE5', padding: '2px 10px', borderRadius: '20px' }}>
                Admin
              </span>
              {admin?.companyName && (
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#3B82F6', backgroundColor: '#EFF6FF', padding: '2px 10px', borderRadius: '20px' }}>
                  {admin.companyName}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Personal details */}
        <div style={{ backgroundColor: 'white', borderRadius: '14px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#111827', margin: '0 0 18px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Personal Details</p>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#6B7280', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Full name</label>
            <input value={name} onChange={e => setName(e.target.value)} style={inputSx} placeholder="Your name" />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#6B7280', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Email address</label>
            <input value={admin?.email || ''} disabled style={disabledInputSx} />
            <p style={{ fontSize: '11px', color: '#9CA3AF', margin: '5px 0 0' }}>Email cannot be changed.</p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={handleSaveName}
              disabled={savingName || name.trim() === (admin?.name || '')}
              style={{ padding: '10px 22px', borderRadius: '10px', border: 'none', backgroundColor: savingName ? '#6EE7B7' : '#10B981', fontSize: '13px', fontWeight: 600, color: 'white', cursor: savingName ? 'not-allowed' : 'pointer', opacity: name.trim() === (admin?.name || '') ? 0.5 : 1 }}
            >
              {savingName ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>

        {/* Company Details */}
        <div style={{ backgroundColor: 'white', borderRadius: '14px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
            <p style={{ fontSize: '13px', fontWeight: 700, color: '#111827', margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Company Details</p>
            {!admin?.companyName && (
              <span style={{ fontSize: '11px', color: '#9CA3AF', backgroundColor: '#F3F4F6', padding: '2px 8px', borderRadius: '20px' }}>Not set</span>
            )}
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#6B7280', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Company name</label>
            <input
              value={admin?.companyName || ''}
              disabled
              style={disabledInputSx}
              placeholder="No company linked"
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#6B7280', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Company ID</label>
            <input
              value={admin?.companyExternalId || ''}
              disabled
              style={disabledInputSx}
              placeholder="No company ID"
            />
          </div>

          <p style={{ fontSize: '11px', color: '#9CA3AF', margin: '12px 0 0' }}>
            Company details are set during registration and cannot be changed here.
          </p>
        </div>

        {/* Password */}
        <div style={{ backgroundColor: 'white', borderRadius: '14px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <p style={{ fontSize: '13px', fontWeight: 700, color: '#111827', margin: '0 0 18px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Change Password</p>

          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#6B7280', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Current password</label>
            <div style={{ position: 'relative' }}>
              <input type={showCurrent ? 'text' : 'password'} value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} style={{ ...inputSx, paddingRight: '40px' }} placeholder="••••••••" />
              <button type="button" onClick={() => setShowCurrent(v => !v)} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: '#9CA3AF' }}>
                {showCurrent ? <EyeOff width={16} height={16} /> : <Eye width={16} height={16} />}
              </button>
            </div>
          </div>

          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#6B7280', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>New password</label>
            <div style={{ position: 'relative' }}>
              <input type={showNew ? 'text' : 'password'} value={newPassword} onChange={e => setNewPassword(e.target.value)} style={{ ...inputSx, paddingRight: '40px' }} placeholder="Min. 8 characters" />
              <button type="button" onClick={() => setShowNew(v => !v)} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', color: '#9CA3AF' }}>
                {showNew ? <EyeOff width={16} height={16} /> : <Eye width={16} height={16} />}
              </button>
            </div>
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#6B7280', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Confirm new password</label>
            <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} style={inputSx} placeholder="••••••••" />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={handleChangePassword}
              disabled={savingPw}
              style={{ padding: '10px 22px', borderRadius: '10px', border: 'none', backgroundColor: savingPw ? '#6EE7B7' : '#10B981', fontSize: '13px', fontWeight: 600, color: 'white', cursor: savingPw ? 'not-allowed' : 'pointer' }}
            >
              {savingPw ? 'Saving…' : 'Update password'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
