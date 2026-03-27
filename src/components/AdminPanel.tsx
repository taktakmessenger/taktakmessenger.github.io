import { useState } from 'react';
import {
  Crown, Users, DollarSign, Settings, BarChart3, Shield,
  MessageCircle, Lock, Eye, Wifi, AlertTriangle, CheckCircle, XCircle,
  Bell, Search, MoreVertical, RefreshCw, Phone, Video, Key, Server,
  Database, Cloud, Zap, Activity
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';

type AdminTab = 'dashboard' | 'users' | 'earnings' | 'security' | 'integrations' | 'calls' | 'settings' | 'economy';

export const AdminPanel = ({ onClose }: { onClose: () => void }) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('dashboard');
  const { adminEarnings } = useStore();

  const stats = [
    { label: 'Usuarios totales', value: '12,450', icon: Users, color: 'text-blue-400' },
    { label: 'Usuarios online', value: '3,280', icon: Wifi, color: 'text-green-400' },
    { label: 'Ganancias hoy', value: '$1,245', icon: DollarSign, color: 'text-yellow-400' },
    { label: 'Mensajes hoy', value: '45,678', icon: MessageCircle, color: 'text-purple-400' },
  ];

  const recentUsers = [
    { id: '1', username: 'user_123', status: 'active', joined: 'Hace 2h' },
    { id: '2', username: 'creator_pro', status: 'active', joined: 'Hace 5h' },
    { id: '3', username: 'new_user', status: 'pending', joined: 'Hace 1h' },
    { id: '4', username: 'viewer_99', status: 'active', joined: 'Ayer' },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <div className="p-4 space-y-4">
            {/* Welcome */}
            <div className="bg-gradient-to-r from-yellow-500/20 to-amber-500/20 p-4 rounded-xl border border-yellow-500/30">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-yellow-500/20 rounded-full flex items-center justify-center">
                  <Crown className="w-6 h-6 text-yellow-400" />
                </div>
                <div>
                  <h2 className="text-white font-bold">Panel de Administrador</h2>
                  <p className="text-zinc-400 text-sm">Cuenta maestra de TakTak</p>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-3">
              {stats.map((stat, i) => (
                <div key={i} className="bg-zinc-900 p-4 rounded-xl">
                  <stat.icon className={`w-5 h-5 ${stat.color} mb-2`} />
                  <p className="text-white text-xl font-bold">{stat.value}</p>
                  <p className="text-zinc-500 text-xs">{stat.label}</p>
                </div>
              ))}
            </div>

            {/* Recent Users */}
            <div className="bg-zinc-900 rounded-xl p-4">
              <h3 className="text-white font-semibold mb-3">Usuarios recientes</h3>
              <div className="space-y-3">
                {recentUsers.map((user) => (
                  <div key={user.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-zinc-800 rounded-full flex items-center justify-center">
                        <Users className="w-4 h-4 text-zinc-500" />
                      </div>
                      <div>
                        <p className="text-white text-sm">{user.username}</p>
                        <p className="text-zinc-500 text-xs">{user.joined}</p>
                      </div>
                    </div>
                    <div className={`w-2 h-2 rounded-full ${user.status === 'active' ? 'bg-green-500' : 'bg-yellow-500'}`} />
                  </div>
                ))}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="grid grid-cols-3 gap-2">
              <Button className="bg-zinc-800 hover:bg-zinc-700" onClick={() => setActiveTab('users')}>
                <Users className="w-4 h-4 mr-1" />
                Usuarios
              </Button>
              <Button className="bg-zinc-800 hover:bg-zinc-700" onClick={() => setActiveTab('earnings')}>
                <DollarSign className="w-4 h-4 mr-1" />
                Ganancias
              </Button>
              <Button className="bg-zinc-800 hover:bg-zinc-700" onClick={() => setActiveTab('security')}>
                <Shield className="w-4 h-4 mr-1" />
                Seguridad
              </Button>
            </div>
          </div>
        );

      case 'users':
        return (
          <div className="p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Search className="w-5 h-5 text-zinc-500" />
              <Input placeholder="Buscar usuarios..." className="bg-zinc-900 border-zinc-800" />
            </div>
            
            <div className="space-y-2">
              {recentUsers.map((user) => (
                <div key={user.id} className="bg-zinc-900 p-3 rounded-xl flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`} alt="" className="w-10 h-10 rounded-full bg-zinc-800" />
                    <div>
                      <p className="text-white font-medium">{user.username}</p>
                      <p className="text-zinc-500 text-xs">ID: {user.id} • {user.joined}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="p-2 hover:bg-zinc-800 rounded-lg" aria-label="Enviar mensaje" title="Enviar mensaje">
                      <MessageCircle className="w-4 h-4 text-zinc-400" />
                    </button>
                    <button className="p-2 hover:bg-zinc-800 rounded-lg" aria-label="Más opciones" title="Más opciones">
                      <MoreVertical className="w-4 h-4 text-zinc-400" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );

      case 'earnings':
        return (
          <div className="p-4 space-y-4">
            <div className="bg-gradient-to-r from-green-500/20 to-emerald-500/20 p-6 rounded-xl border border-green-500/30 text-center">
              <p className="text-zinc-400 text-sm">Ganancias totales</p>
              <p className="text-4xl font-bold text-green-400">${adminEarnings.toFixed(2)}</p>
              <p className="text-zinc-500 text-xs mt-2">USD acumulados</p>
            </div>

            <div className="space-y-3">
              <div className="bg-zinc-900 p-4 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white">Poker</span>
                  <span className="text-green-400">$850.00</span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-green-500 w-3/4 rounded-full" />
                </div>
              </div>

              <div className="bg-zinc-900 p-4 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white">Regalos</span>
                  <span className="text-green-400">$280.50</span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-purple-500 w-1/2 rounded-full" />
                </div>
              </div>

              <div className="bg-zinc-900 p-4 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-white">Videos</span>
                  <span className="text-green-400">$114.50</span>
                </div>
                <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-pink-500 w-1/4 rounded-full" />
                </div>
              </div>
            </div>

            <Button className="w-full bg-green-600 hover:bg-green-700">
              <DollarSign className="w-4 h-4 mr-2" />
              Retirar ganancias
            </Button>
          </div>
        );

      case 'security':
        return (
          <div className="p-4 space-y-4">
            <h3 className="text-white font-semibold">Estado de seguridad</h3>
            
            <div className="space-y-3">
              <div className="bg-zinc-900 p-4 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Shield className="w-5 h-5 text-green-400" />
                  <div>
                    <p className="text-white text-sm">Encriptación E2E</p>
                    <p className="text-zinc-500 text-xs">Activa</p>
                  </div>
                </div>
                <CheckCircle className="w-5 h-5 text-green-400" />
              </div>

              <div className="bg-zinc-900 p-4 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Lock className="w-5 h-5 text-green-400" />
                  <div>
                    <p className="text-white text-sm">Autenticación</p>
                    <p className="text-zinc-500 text-xs">2FA activo</p>
                  </div>
                </div>
                <CheckCircle className="w-5 h-5 text-green-400" />
              </div>

              <div className="bg-zinc-900 p-4 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Eye className="w-5 h-5 text-yellow-400" />
                  <div>
                    <p className="text-white text-sm">Modo invisible</p>
                    <p className="text-zinc-500 text-xs">Desactivado</p>
                  </div>
                </div>
                <XCircle className="w-5 h-5 text-yellow-400" />
              </div>

              <div className="bg-zinc-900 p-4 rounded-xl flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-green-400" />
                  <div>
                    <p className="text-white text-sm">Firewalls</p>
                    <p className="text-zinc-500 text-xs">Protegiendo</p>
                  </div>
                </div>
                <CheckCircle className="w-5 h-5 text-green-400" />
              </div>
            </div>

            <Button variant="outline" className="w-full border-zinc-700">
              <Settings className="w-4 h-4 mr-2" />
              Configuración de seguridad
            </Button>
          </div>
        );

      case 'settings':
        return (
          <div className="p-4 space-y-4">
            <h3 className="text-white font-semibold">Configuración del sistema</h3>
            
            <div className="space-y-2">
              <Button variant="outline" className="w-full justify-start border-zinc-700">
                <Settings className="w-4 h-4 mr-2" />
                Configuración general
              </Button>
              <Button variant="outline" className="w-full justify-start border-zinc-700">
                <Bell className="w-4 h-4 mr-2" />
                Notificaciones
              </Button>
              <Button variant="outline" className="w-full justify-start border-zinc-700">
                <BarChart3 className="w-4 h-4 mr-2" />
                Estadísticas
              </Button>
              <Button variant="outline" className="w-full justify-start border-zinc-700">
                <RefreshCw className="w-4 h-4 mr-2" />
                Sincronización
              </Button>
            </div>
          </div>
        );

      case 'integrations':
        return (
          <div className="p-4 space-y-4">
            <h3 className="text-white font-semibold">Integraciones</h3>
            
            {/* Twilio SMS */}
            <div className="bg-zinc-900 p-4 rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-red-500/20 rounded-lg flex items-center justify-center">
                    <MessageCircle className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <p className="text-white font-medium">Twilio SMS</p>
                    <p className="text-zinc-500 text-xs">Verificación de números</p>
                  </div>
                </div>
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
              </div>
              <div className="space-y-2">
                <Input 
                  placeholder="Account SID" 
                  type="password"
                  className="bg-zinc-800 border-zinc-700 text-sm"
                  defaultValue="AC*****************************"
                />
                <Input 
                  placeholder="Auth Token" 
                  type="password"
                  className="bg-zinc-800 border-zinc-700 text-sm"
                  defaultValue="********************************"
                />
                <Button 
                  size="sm" 
                  className="w-full bg-red-600 hover:bg-red-700"
                  onClick={() => toast.success('Twilio configurado correctamente')}
                >
                  <Key className="w-4 h-4 mr-2" />
                  Guardar credenciales
                </Button>
              </div>
            </div>

            {/* Encryption Keys */}
            <div className="bg-zinc-900 p-4 rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
                    <Lock className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-white font-medium">Encriptación E2E</p>
                    <p className="text-zinc-500 text-xs">Signal Protocol</p>
                  </div>
                </div>
                <CheckCircle className="w-5 h-5 text-green-400" />
              </div>
              <div className="space-y-2">
                <Input 
                  placeholder="Clave pública del servidor" 
                  className="bg-zinc-800 border-zinc-700 text-sm font-mono"
                  defaultValue="MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A..."
                />
                <p className="text-zinc-500 text-xs">
                  🔒 Las claves se generan automáticamente. Los mensajes están encriptados de extremo a extremo.
                </p>
              </div>
            </div>

            {/* Backend Server */}
            <div className="bg-zinc-900 p-4 rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-purple-500/20 rounded-lg flex items-center justify-center">
                    <Server className="w-5 h-5 text-purple-400" />
                  </div>
                  <div>
                    <p className="text-white font-medium">Backend API</p>
                    <p className="text-zinc-500 text-xs">Sincronización de datos</p>
                  </div>
                </div>
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
              </div>
              <div className="space-y-2">
                <Input 
                  placeholder="https://api.taktak.com"
                  className="bg-zinc-800 border-zinc-700 text-sm"
                  defaultValue="https://api.taktak.com/v1"
                />
                <Input 
                  placeholder="API Key"
                  type="password"
                  className="bg-zinc-800 border-zinc-700 text-sm"
                  defaultValue="tk_live_************************"
                />
                <div className="flex gap-2">
                  <Button 
                    size="sm" 
                    className="flex-1 bg-purple-600 hover:bg-purple-700"
                    onClick={() => toast.success('Conectado al backend')}
                  >
                    <Cloud className="w-4 h-4 mr-1" />
                    Conectar
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline"
                    className="border-zinc-700"
                    onClick={() => toast.info('Probando conexión...')}
                    aria-label="Probar conexión"
                    title="Probar conexión"
                  >
                    <Activity className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Database */}
            <div className="bg-zinc-900 p-4 rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center">
                    <Database className="w-5 h-5 text-green-400" />
                  </div>
                  <div>
                    <p className="text-white font-medium">Base de Datos</p>
                    <p className="text-zinc-500 text-xs">MongoDB Encriptado</p>
                  </div>
                </div>
                <CheckCircle className="w-5 h-5 text-green-400" />
              </div>
              <p className="text-zinc-500 text-xs">
                📊 1.2GB usado • 45,678 mensajes almacenados • 12,450 usuarios
              </p>
            </div>
          </div>
        );

      case 'calls':
        return (
          <div className="p-4 space-y-4">
            <h3 className="text-white font-semibold">Llamadas y Video</h3>
            
            {/* Voice Calls */}
            <div className="bg-zinc-900 p-4 rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center">
                    <Phone className="w-5 h-5 text-green-400" />
                  </div>
                  <div>
                    <p className="text-white font-medium">Llamadas de Voz</p>
                    <p className="text-zinc-500 text-xs">VoIP con WebRTC</p>
                  </div>
                </div>
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2 bg-zinc-800 rounded-lg">
                  <span className="text-zinc-400 text-sm">Calidad de audio</span>
                  <span className="text-green-400 text-sm">Alta (HD)</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-zinc-800 rounded-lg">
                  <span className="text-zinc-400 text-sm">Codec</span>
                  <span className="text-white text-sm">Opus</span>
                </div>
                <Button 
                  size="sm" 
                  className="w-full bg-green-600 hover:bg-green-700"
                >
                  <Settings className="w-4 h-4 mr-2" />
                  Configurar
                </Button>
              </div>
            </div>

            {/* Video Calls */}
            <div className="bg-zinc-900 p-4 rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
                    <Video className="w-5 h-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-white font-medium">Videollamadas</p>
                    <p className="text-zinc-500 text-xs">WebRTC + STUN/TURN</p>
                  </div>
                </div>
                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2 bg-zinc-800 rounded-lg">
                  <span className="text-zinc-400 text-sm">Resolución</span>
                  <span className="text-white text-sm">720p / 1080p</span>
                </div>
                <div className="flex items-center justify-between p-2 bg-zinc-800 rounded-lg">
                  <span className="text-zinc-400 text-sm">Frame rate</span>
                  <span className="text-white text-sm">30 FPS</span>
                </div>
                <Input 
                  placeholder="STUN Server"
                  className="bg-zinc-800 border-zinc-700 text-sm"
                  defaultValue="stun:stun.l.google.com:19302"
                />
                <Input 
                  placeholder="TURN Server"
                  className="bg-zinc-800 border-zinc-700 text-sm"
                  defaultValue="turn:turn.taktak.com:3478"
                />
                <Button 
                  size="sm" 
                  className="w-full bg-blue-600 hover:bg-blue-700"
                  onClick={() => toast.success('Servidores de video configurados')}
                >
                  <Zap className="w-4 h-4 mr-2" />
                  Guardar configuración
                </Button>
              </div>
            </div>

            {/* Call Statistics */}
            <div className="bg-zinc-900 p-4 rounded-xl">
              <h4 className="text-white font-medium mb-3">Estadísticas de llamadas</h4>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-zinc-800 p-3 rounded-lg text-center">
                  <p className="text-green-400 text-xl font-bold">1,234</p>
                  <p className="text-zinc-500 text-xs">Llamadas hoy</p>
                </div>
                <div className="bg-zinc-800 p-3 rounded-lg text-center">
                  <p className="text-blue-400 text-xl font-bold">89%</p>
                  <p className="text-zinc-500 text-xs">Conexión exitosa</p>
                </div>
                <div className="bg-zinc-800 p-3 rounded-lg text-center">
                  <p className="text-purple-400 text-xl font-bold">4.5 min</p>
                  <p className="text-zinc-500 text-xs">Duración prom.</p>
                </div>
                <div className="bg-zinc-800 p-3 rounded-lg text-center">
                  <p className="text-yellow-400 text-xl font-bold">0.2%</p>
                  <p className="text-zinc-500 text-xs">Llamadas fallidas</p>
                </div>
              </div>
            </div>
          </div>
        );

      case 'economy': {
        const { bmPrincipal, bmIncentivo } = useStore.getState();
        return (
          <div className="p-4 space-y-4">
            <div className="bg-gradient-to-r from-green-500/20 to-emerald-500/20 p-6 rounded-xl border border-green-500/30 text-center">
              <p className="text-zinc-400 text-sm italic">BM‑PRINCIPAL (Plataforma - Regalos)</p>
              <p className="text-4xl font-bold text-green-400">{bmPrincipal?.toLocaleString() || 0} TTC</p>
              <p className="text-zinc-500 text-xs mt-2">≈ ${(bmPrincipal * 0.01).toLocaleString()} USD</p>
            </div>

            <div className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 p-6 rounded-xl border border-purple-500/30 text-center">
              <p className="text-zinc-400 text-sm italic">BM‑INCENTIVO (Admin - 10% Minado)</p>
              <p className="text-4xl font-bold text-purple-400">{bmIncentivo?.toLocaleString() || 0} TTC</p>
              <p className="text-zinc-500 text-xs mt-2">≈ ${(bmIncentivo * 0.01).toLocaleString()} USD</p>
              <Button 
                onClick={() => {
                  if (useStore.getState().withdrawIncentivo()) {
                    toast.success('Incentivo retirado con éxito');
                  } else {
                    toast.error('No hay incentivos para retirar');
                  }
                }}
                className="mt-4 bg-purple-500 hover:bg-purple-600 w-full"
              >
                Retirar Incentivo 10%
              </Button>
            </div>
            
            <div className="bg-zinc-900 p-4 rounded-xl">
              <h3 className="text-white font-semibold mb-3">Red de Minado P2P</h3>
              <div className="flex items-center justify-between mb-2">
                <span className="text-zinc-400 text-sm">Nodos activos</span>
                <span className="text-green-400 font-bold">428</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400 text-sm">Tráfico P2P 24h</span>
                <span className="text-blue-400 font-bold">1.2 TB</span>
              </div>
            </div>
          </div>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full bg-black">
      {/* Header */}
      <div className="bg-[#00a884] px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Crown className="w-5 h-5 text-white" />
          <h1 className="text-white font-medium">Admin Panel</h1>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-[#009577] rounded-full" aria-label="Cerrar" title="Cerrar">
          <XCircle className="w-5 h-5 text-white" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800 overflow-x-auto">
        {[
          { id: 'dashboard', icon: BarChart3, label: 'Panel' },
          { id: 'users', icon: Users, label: 'Usuarios' },
          { id: 'earnings', icon: DollarSign, label: 'Dinero' },
          { id: 'security', icon: Shield, label: 'Segurid' },
          { id: 'integrations', icon: Server, label: 'API' },
          { id: 'calls', icon: Phone, label: 'Llamadas' },
          { id: 'economy', icon: Zap, label: 'Economía' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as AdminTab)}
            className={`flex-1 py-3 flex flex-col items-center gap-1 ${
              activeTab === tab.id ? 'text-[#00a884] border-b-2 border-[#00a884]' : 'text-zinc-500'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            <span className="text-xs">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {renderContent()}
      </div>
    </div>
  );
};
