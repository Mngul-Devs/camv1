import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useOrganization } from '../contexts/OrganizationContext';
import { Eye, EyeOff, Layers } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { toast } from 'sonner';

export function SignInPage() {
  const navigate = useNavigate();
  const { signIn } = useOrganization();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('Please enter your username');
      return;
    }
    if (!password.trim()) {
      setError('Please enter your password');
      return;
    }

    setIsLoading(true);

    const success = await signIn(email, password);
    if (success) {
      toast.success('Welcome back!', { description: 'Signed in successfully' });
      navigate('/app');
    } else {
      setError('Invalid username or password');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0b] flex">
      {/* Left side - branding */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-emerald-950/40 via-[#0a0a0b] to-blue-950/30" />
        <div className="absolute inset-0" style={{
          backgroundImage: `radial-gradient(circle at 1px 1px, rgba(255,255,255,0.05) 1px, transparent 0)`,
          backgroundSize: '40px 40px',
        }} />
        <div className="relative z-10 flex flex-col justify-between p-12">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-lg flex items-center justify-center">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <span className="text-white text-lg">ParkVision</span>
          </div>

          <div className="max-w-md">
            <h1 className="text-4xl text-white mb-4" style={{ lineHeight: 1.2 }}>
              Intelligent Parking Monitoring
            </h1>
            <p className="text-gray-400 text-lg">
              Real-time vehicle detection, automated snapshot processing, and comprehensive analytics for your parking infrastructure.
            </p>
            <div className="mt-8 grid grid-cols-3 gap-6">
              <div>
                <div className="text-2xl text-white">10K+</div>
                <div className="text-sm text-gray-500 mt-1">Cameras managed</div>
              </div>
              <div>
                <div className="text-2xl text-white">99.9%</div>
                <div className="text-sm text-gray-500 mt-1">Uptime SLA</div>
              </div>
              <div>
                <div className="text-2xl text-white">{'<'}200ms</div>
                <div className="text-sm text-gray-500 mt-1">Detection latency</div>
              </div>
            </div>
          </div>

          <div className="text-sm text-gray-600">
            &copy; 2026 ParkVision. All rights reserved.
          </div>
        </div>
      </div>

      {/* Right side - sign in form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-emerald-600 rounded-lg flex items-center justify-center">
              <Layers className="w-5 h-5 text-white" />
            </div>
            <span className="text-white text-lg">ParkVision</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl text-white mb-2">Welcome back</h2>
            <p className="text-gray-500 text-sm">Sign in to your account to continue</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label className="text-gray-400 text-sm">Username</Label>
              <Input
                type="text"
                placeholder="admin"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                className="bg-[#111113] border-gray-800 text-white placeholder:text-gray-600 h-11 focus:border-emerald-500 focus:ring-emerald-500/20"
                autoComplete="username"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-gray-400 text-sm">Password</Label>
                <button
                  type="button"
                  className="text-xs text-emerald-500 hover:text-emerald-400 transition-colors"
                >
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  className="bg-[#111113] border-gray-800 text-white placeholder:text-gray-600 h-11 pr-10 focus:border-emerald-500 focus:ring-emerald-500/20"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-400"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 bg-emerald-600 hover:bg-emerald-700 text-white transition-all disabled:opacity-50"
            >
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in...
                </div>
              ) : (
                'Sign in'
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              Don't have an account?{' '}
              <button className="text-emerald-500 hover:text-emerald-400 transition-colors">
                Contact sales
              </button>
            </p>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-800/50">
            <p className="text-xs text-gray-600 text-center">
              Demo credentials are pre-filled. Click "Sign in" to continue.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}