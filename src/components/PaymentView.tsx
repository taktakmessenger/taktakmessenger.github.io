import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  QrCode, Lock, ArrowLeft, Gift, CheckCircle, Crown,
  ArrowUpRight, ArrowDownLeft, History, TrendingUp, Zap
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useStore } from '@/store/useStore';
import { toast } from 'sonner';

interface PaymentMethod {
  id: string;
  name: string;
  icon: string;
  description: string;
}

const paymentMethods: PaymentMethod[] = [
  { id: 'stripe', name: 'Tarjeta Débito/Crédito', icon: '💳', description: 'Visa, Mastercard, American Express' },
  { id: 'paypal', name: 'PayPal', icon: '🔵', description: 'Pagos internacionales' },
  { id: 'mercadopago', name: 'MercadoPago', icon: '💰', description: 'Argentina, México, Colombia, Chile' },
  { id: 'zelle', name: 'Zelle (USA)', icon: '💜', description: 'Pago instantáneo desde tu banco' },
  { id: 'zinli', name: 'Zinli (Sinli)', icon: '💖', description: 'Billetera digital Panamá' },
  { id: 'binance', name: 'Binance Pay', icon: '🟡', description: 'Criptomonedas seguras' },
  { id: 'pago_movil', name: 'Pago Móvil', icon: '📱', description: 'Venezuela - Banesco/Provincial' },
  { id: 'zelle_banesco', name: 'Banesco Panama (Zelle)', icon: '🏦', description: 'Desde $10 USD' },
  { id: 'cash', name: 'Efectivo', icon: '💵', description: 'Pago presencial' },
  { id: 'crypto', name: 'Criptomonedas', icon: '₿', description: 'BTC, USDT, ETH' },
  { id: 'airtm', name: 'Airtm', icon: '🌐', description: 'Bolsas locales Venezuela' },
  { id: 'western_union', name: 'Western Union', icon: '🌎', description: 'Envíos internacionales' },
  { id: 'banesco_ve', name: 'Banesco Online', icon: '🏦', description: 'Pagos desde Venezuela' },
  { id: 'payoneer', name: 'Payoneer', icon: '💠', description: 'Pagos globales business' },
  { id: 'payeer', name: 'Payeer (Rusia)', icon: '🇷🇺', description: 'Billetera electrónica internacional' },
];

const packages = [
  { id: 'basic', name: 'Básico', price: 4.99, credits: 100, popular: false },
  { id: 'standard', name: 'Estándar', price: 9.99, credits: 250, popular: true },
  { id: 'premium', name: 'Premium', price: 19.99, credits: 600, popular: false },
  { id: 'vip', name: 'VIP', price: 49.99, credits: 2000, popular: false },
];

const subscriptions = [
  { id: 'monthly', name: 'Premium Mensual', price: 4.99, features: ['Sin anuncios', 'Fichas ilimitadas', 'Badges exclusivos'] },
  { id: 'yearly', name: 'Premium Anual', price: 39.99, features: ['Todo mensual', '20% descuento', 'Soporte prioritario'] },
];

export const PaymentView = () => {
  const { ttcC, ttcR, addTtcC } = useStore();
  const [activeTab, setActiveTab] = useState<'recharge' | 'buy' | 'subscription' | 'withdraw' | 'send' | 'swap'>('recharge');
  const [selectedMethod, setSelectedMethod] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showPaymentDetails, setShowPaymentDetails] = useState(false);

  const handleRecharge = () => {
    if (!selectedMethod || !amount) {
      toast.error('Selecciona un método e ingresa un monto');
      return;
    }

    setIsProcessing(true);
    
    setTimeout(() => {
      const value = parseFloat(amount);
      addTtcC(value);
      setIsProcessing(false);
      setShowPaymentDetails(true);
      toast.success(`¡Recarga de $${value} exitosa!`);
    }, 2000);
  };

  const handlePackageBuy = (pkg: typeof packages[0]) => {
    setIsProcessing(true);
    
    setTimeout(() => {
      addTtcC(pkg.credits);
      setIsProcessing(false);
      toast.success(`¡${pkg.name} activado! +${pkg.credits} fichas`);
    }, 1500);
  };

  const handleSubscription = (sub: typeof subscriptions[0]) => {
    setIsProcessing(true);
    
    setTimeout(() => {
      setIsProcessing(false);
      toast.success(`¡${sub.name} activado! Bienvenido a Premium`);
    }, 1500);
  };

  if (showPaymentDetails && selectedMethod) {
    return <PaymentDetails method={selectedMethod} amount={amount} onClose={() => setShowPaymentDetails(false)} />;
  }

  return (
    <div className="flex flex-col h-screen bg-black text-white">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-pink-600 p-6">
        <div className="flex items-center justify-between mb-4">
          <button 
            onClick={() => window.history.back()} 
            className="p-2 hover:bg-white/10 rounded-full"
            aria-label="Volver"
            title="Volver"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">Billetera</h1>
          <div className="w-10" />
        </div>
        
        <div className="grid grid-cols-2 gap-4 text-center mt-2">
          <div>
            <p className="text-white/70 text-xs uppercase tracking-wider">TTC‑C (Interno)</p>
            <p className="text-2xl font-bold">{ttcC?.toLocaleString() || 0}</p>
            <p className="text-[10px] text-white/40 font-mono">${(ttcC * 0.01).toFixed(2)} USD</p>
          </div>
          <div>
            <p className="text-white/70 text-xs uppercase tracking-wider">TTC‑R (Premios)</p>
            <p className="text-2xl font-bold">{ttcR?.toLocaleString() || 0}</p>
            <p className="text-[10px] text-white/40 font-mono">${(ttcR * 0.00001).toFixed(2)} USD</p>
          </div>
        </div>
        <div className="mt-4 flex flex-col items-center gap-1">
          <p className="text-white/30 text-[10px] uppercase tracking-tighter">Suministro Total (Max Supply): 50,000,000 TTC</p>
          <p className="text-white/30 text-[10px] uppercase">1,000 TTC-R ≈ 0.01 USD | 1 TTC-C = 0.01 USD</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800 overflow-x-auto hide-scrollbar">
        <button
          onClick={() => setActiveTab('recharge')}
          className={`flex-shrink-0 px-6 py-3 text-sm font-medium flex items-center gap-2 ${activeTab === 'recharge' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-zinc-500'}`}
        >
          <ArrowDownLeft className="w-4 h-4" /> Recargar
        </button>
        <button
          onClick={() => setActiveTab('send')}
          className={`flex-shrink-0 px-6 py-3 text-sm font-medium flex items-center gap-2 ${activeTab === 'send' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-zinc-500'}`}
        >
          <ArrowUpRight className="w-4 h-4" /> Enviar
        </button>
        <button
          onClick={() => setActiveTab('swap')}
          className={`flex-shrink-0 px-6 py-3 text-sm font-medium flex items-center gap-2 ${activeTab === 'swap' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-zinc-500'}`}
        >
          <TrendingUp className="w-4 h-4" /> Swap
        </button>
        <button
          onClick={() => setActiveTab('buy')}
          className={`flex-shrink-0 px-6 py-3 text-sm font-medium flex items-center gap-2 ${activeTab === 'buy' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-zinc-500'}`}
        >
          <Zap className="w-4 h-4" /> Paquetes
        </button>
        <button
          className="flex-shrink-0 px-6 py-3 text-sm font-medium flex items-center gap-2 text-zinc-500"
        >
          <History className="w-4 h-4" /> Historial
        </button>
        <button
          onClick={() => setActiveTab('subscription')}
          className={`flex-shrink-0 px-6 py-3 text-sm font-medium ${activeTab === 'subscription' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-zinc-500'}`}
        >
          Premium
        </button>
        <button
          onClick={() => setActiveTab('withdraw')}
          className={`flex-shrink-0 px-6 py-3 text-sm font-medium ${activeTab === 'withdraw' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-zinc-500'}`}
        >
          Retirar
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Economic Restrictions Panel */}
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4">
          <h3 className="text-zinc-400 text-[10px] font-bold uppercase tracking-widest mb-3 flex items-center gap-2">
            <Lock className="w-3 h-3" /> Restricciones de Economía
          </h3>
          <div className="space-y-2">
            <div className="flex items-start gap-2 text-xs">
              <div className="w-1.5 h-1.5 rounded-full bg-purple-500 mt-1" />
              <p className="text-zinc-300"><span className="text-white font-semibold">TTC-C (Compras):</span> Exclusivas para regalos y contenido. No transferibles externamente.</p>
            </div>
            <div className="flex items-start gap-2 text-xs">
              <div className="w-1.5 h-1.5 rounded-full bg-[#25F4EE] mt-1" />
              <p className="text-zinc-300"><span className="text-white font-semibold">TTC-R (Premios):</span> Canjeables, enviables y vendibles sin restricciones internas.</p>
            </div>
          </div>
        </div>

        {activeTab === 'recharge' && (
          <div className="space-y-4">
            <div className="bg-zinc-900 rounded-xl p-4">
              <label className="text-zinc-400 text-sm mb-2 block">Monto a recargar (USD)</label>
              <div className="flex items-center gap-2">
                <span className="text-2xl text-zinc-400">$</span>
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="bg-transparent border-none text-3xl font-bold text-white"
                />
              </div>
            </div>

            <div>
              <h3 className="text-white font-semibold mb-3">Método de pago</h3>
              <div className="grid grid-cols-2 gap-3">
                {paymentMethods.map((method) => (
                  <motion.button
                    key={method.id}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setSelectedMethod(method.id)}
                    className={`p-4 rounded-xl text-left transition-all ${
                      selectedMethod === method.id
                        ? 'bg-[#FE2C55]/20 border-2 border-[#FE2C55]'
                        : 'bg-zinc-900 border-2 border-transparent hover:border-zinc-700'
                    }`}
                  >
                    <span className="text-2xl mb-2 block">{method.icon}</span>
                    <p className="font-medium text-white">{method.name}</p>
                    <p className="text-xs text-zinc-500">{method.description}</p>
                  </motion.button>
                ))}
              </div>
            </div>

            <Button
              onClick={handleRecharge}
              disabled={!selectedMethod || !amount || isProcessing}
              className={`w-full py-6 text-lg text-black font-black uppercase tracking-widest transition-all ${
                selectedMethod && amount 
                  ? 'bg-gradient-to-r from-[#FE2C55] via-[#25F4EE] to-[#FE2C55] bg-[length:200%_auto] animate-gradient-x shadow-[0_0_20px_rgba(37,244,238,0.3)] scale-[1.02]' 
                  : 'bg-zinc-800 text-zinc-500'
              }`}
            >
              {isProcessing ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" />
                  Procesando...
                </div>
              ) : selectedMethod ? (
                `CONFIRMAR PAGO $${amount || '0'}`
              ) : (
                'SELECCIONA MÉTODO'
              )}
            </Button>
          </div>
        )}

        {activeTab === 'send' && (
          <div className="space-y-4">
            <div className="bg-zinc-900 rounded-xl p-4">
              <label className="text-zinc-400 text-sm mb-2 block">Destinatario (Email o Wallet)</label>
              <Input
                placeholder="0x... o email"
                className="bg-transparent border-zinc-800 text-white"
              />
            </div>
            <div className="bg-zinc-900 rounded-xl p-4">
              <label className="text-zinc-400 text-sm mb-2 block">Monto a enviar (TTC‑R)</label>
              <div className="flex items-center gap-2">
                <span className="text-2xl text-[#25F4EE]">R</span>
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="bg-transparent border-none text-3xl font-bold text-white"
                />
              </div>
            </div>
            <Button
              onClick={() => {
                if (useStore.getState().sendTtcR(parseFloat(amount), '')) {
                  toast.success('Envío completado');
                  setAmount('');
                } else {
                  toast.error('Saldo TTC-R insuficiente');
                }
              }}
              className="w-full bg-[#25F4EE] hover:bg-[#20d8d2] text-black font-bold py-6 text-lg"
            >
              Enviar Monedas
            </Button>
          </div>
        )}

        {activeTab === 'swap' && (
          <div className="space-y-4">
            <div className="bg-zinc-900 rounded-xl p-4">
              <label className="text-zinc-400 text-sm mb-2 block">De: TTC-R</label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="bg-transparent border-none text-2xl font-bold text-white flex-1"
                />
              </div>
            </div>
            <div className="flex justify-center -my-2 relative z-10">
              <div className="bg-zinc-800 p-2 rounded-full border border-zinc-700">
                <ArrowLeft className="w-4 h-4 text-pink-400 rotate-[-90deg]" />
              </div>
            </div>
            <div className="bg-zinc-900 rounded-xl p-4">
              <label className="text-zinc-400 text-sm mb-2 block">A: USDT (Cripto)</label>
              <div className="flex items-center justify-between">
                <span className="text-2xl font-bold text-white">{(parseFloat(amount) * 0.01 || 0).toFixed(2)}</span>
                <span className="text-zinc-500 font-bold">USDT</span>
              </div>
            </div>
            <Button
              onClick={() => {
                if (useStore.getState().swapTtcR(parseFloat(amount), 'USDT')) {
                  toast.success('Swap completado con éxito');
                  setAmount('');
                } else {
                  toast.error('Saldo insuficiente');
                }
              }}
              className="w-full bg-pink-600 hover:bg-pink-700 text-white font-bold py-6 text-lg"
            >
              Confirmar Swap
            </Button>
          </div>
        )}

        {activeTab === 'buy' && (
          <div className="space-y-3">
            {packages.map((pkg) => (
              <motion.div
                key={pkg.id}
                whileTap={{ scale: 0.98 }}
                className={`p-4 rounded-xl flex items-center justify-between ${
                  pkg.popular ? 'bg-[#FE2C55]/20 border-2 border-[#FE2C55]' : 'bg-zinc-900'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    pkg.popular ? 'bg-[#FE2C55]' : 'bg-zinc-800'
                  }`}>
                    <Gift className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <p className="font-semibold text-white">{pkg.name}</p>
                    <p className="text-zinc-400 text-sm">{pkg.credits} fichas</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-white">${pkg.price}</p>
                  <Button
                    size="sm"
                    onClick={() => handlePackageBuy(pkg)}
                    disabled={isProcessing}
                    className="mt-1 bg-[#FE2C55] hover:bg-[#ff4d6d]"
                  >
                    Comprar
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {activeTab === 'subscription' && (
          <div className="space-y-4">
            {subscriptions.map((sub) => (
              <motion.div
                key={sub.id}
                whileTap={{ scale: 0.98 }}
                className="bg-gradient-to-r from-yellow-500/20 to-amber-500/20 rounded-xl p-4 border border-yellow-500/30"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Crown className="w-5 h-5 text-yellow-400" />
                    <p className="font-bold text-white">{sub.name}</p>
                  </div>
                  <p className="text-xl font-bold text-yellow-400">${sub.price}</p>
                </div>
                <ul className="space-y-2 mb-3">
                  {sub.features.map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-zinc-300 text-sm">
                      <CheckCircle className="w-4 h-4 text-green-400" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button
                  onClick={() => handleSubscription(sub)}
                  disabled={isProcessing}
                  className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-bold"
                >
                  {isProcessing ? 'Activando...' : 'Suscribirse'}
                </Button>
              </motion.div>
            ))}
          </div>
        )}

        {activeTab === 'withdraw' && (
          <div className="space-y-4">
            <div className="bg-zinc-900 rounded-xl p-4">
              <label className="text-zinc-400 text-sm mb-2 block">Monto a retirar (TTC‑R)</label>
              <div className="flex items-center gap-2">
                <span className="text-2xl text-[#25F4EE]">R</span>
                <Input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="bg-transparent border-none text-3xl font-bold text-white"
                />
              </div>
              <p className="text-xs text-zinc-500 mt-2 italic">Solo puedes retirar monedas ganadas de regalos y minado.</p>
            </div>

            <div>
              <h3 className="text-white font-semibold mb-3">Método de retiro</h3>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { id: 'zelle_withdraw', name: 'Zelle', icon: '💜' },
                  { id: 'zinli_withdraw', name: 'Zinli', icon: '💖' },
                  { id: 'payoneer_withdraw', name: 'Payoneer', icon: '💠' },
                  { id: 'payeer_withdraw', name: 'Payeer', icon: '🇷🇺' },
                  { id: 'crypto_withdraw', name: 'Cripto', icon: '₿' },
                  { id: 'paypal_withdraw', name: 'PayPal', icon: '🔵' },
                ].map((m) => (
                  <motion.button
                    key={m.id}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => setSelectedMethod(m.id)}
                    className={`p-4 rounded-xl text-left transition-all ${
                      selectedMethod === m.id
                        ? 'bg-[#25F4EE]/20 border-2 border-[#25F4EE]'
                        : 'bg-zinc-900 border-2 border-transparent hover:border-zinc-700'
                    }`}
                  >
                    <span className="text-2xl mb-2 block">{m.icon}</span>
                    <p className="font-medium text-white">{m.name}</p>
                  </motion.button>
                ))}
              </div>
            </div>

            <Button
              onClick={() => {
                if (!amount || parseFloat(amount) > ttcR) {
                  toast.error('Saldo TTC‑R insuficiente');
                  return;
                }
                setIsProcessing(true);
                setTimeout(() => {
                  useStore.getState().addTtcR(-parseFloat(amount));
                  setIsProcessing(false);
                  toast.success('Solicitud de retiro enviada');
                  setAmount('');
                }, 2000);
              }}
              disabled={!selectedMethod || !amount || isProcessing}
              className="w-full bg-[#25F4EE] hover:bg-[#20d8d2] py-4 text-black font-bold"
            >
              {isProcessing ? 'Procesando retiro...' : 'Confirmar Retiro'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

const PaymentDetails = ({ method, amount, onClose }: { method: string; amount: string; onClose: () => void }) => {
  const methodInfo = paymentMethods.find(m => m.id === method);
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvc, setCardCvc] = useState('');
  const [reference, setReference] = useState('');
  const [senderInfo, setSenderInfo] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const needsReference = ['pago_movil', 'binance', 'zelle', 'payoneer', 'payeer', 'crypto', 'banesco_ve', 'western_union', 'airtm', 'zinli'].includes(method);
  const senderLabel = ['pago_movil'].includes(method) ? 'Teléfono / Cédula del emisor' : 'Email / Usuario del emisor';

  const formatCardNumber = (value: string) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    const matches = v.match(/\d{4,16}/g);
    const match = matches && matches[0] || '';
    const parts = [];
    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4));
    }
    return parts.length ? parts.join(' ') : value;
  };

  const formatExpiry = (value: string) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    if (v.length >= 2) {
      return v.substring(0, 2) + '/' + v.substring(2, 4);
    }
    return v;
  };

  const handleSubmit = () => {
    if (method === 'stripe' && (!cardNumber || !cardExpiry || !cardCvc)) {
      toast.error('Completa los datos de la tarjeta');
      return;
    }
    if (needsReference && (!reference || !senderInfo)) {
      toast.error('Por favor ingresa la referencia y tus datos de emisor');
      return;
    }

    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      toast.success('¡Solicitud recibida!', {
        description: 'Nuestro equipo verificará el pago en unos minutos.'
      });
      onClose();
    }, 2000);
  };

  const getPaymentInstructions = () => {
    switch (method) {
      case 'stripe':
        return {
          steps: [
            '1. Serás redirigido a Stripe',
            '2. Ingresa los datos de tu tarjeta',
            '3. Visa, Mastercard, AMEX aceptadas',
          ],
          note: 'Pago 100% seguro con encriptación SSL',
          needsCardForm: true
        };
      case 'paypal':
        return {
          steps: [
            '1. Serás redirigido a PayPal',
            '2. Inicia sesión o paga con tarjeta',
            '3. Confirmación automática',
          ],
          note: 'Acepta tarjetas de cualquier banco'
        };
      case 'mercadopago':
        return {
          steps: [
            '1. Selecciona MercadoPago',
            '2. Paga con saldo o tarjeta',
            '3. Argentina, México, Colombia, Chile',
          ],
          note: 'MercadoPago te protege en compras'
        };
      case 'zelle':
        return {
          steps: [
            '1. Abre tu app de Zelle',
            '2. Envía $' + amount + ' a: payments@taktak.com',
            '3. Ingresa la referencia abajo',
          ],
          note: 'El saldo se acreditará en 5-15 minutos'
        };
      case 'binance':
        return {
          steps: [
            '1. Abre Binance y ve a Pagos',
            '2. Escanea el código QR o ID: 29384756',
            '3. Envía USDT y coloca el ID de transacción abajo',
          ],
          note: 'Rápido y sin comisiones'
        };
      case 'pago_movil':
        return {
          steps: [
            '1. Realiza el Pago Móvil por $' + amount,
            '2. Datos: 0412-1234567 | V-12345678 | Banesco',
            '3. Ingresa la referencia y tu número abajo',
          ],
          note: 'Acreditación inmediata al verificar'
        };
      case 'zelle_banesco':
        return {
          steps: [
            '1. Envía $' + amount + ' por Zelle',
            '2. Email: eliecerdepablos@gmail.com',
            '3. Alternativo: elmalayaso7@gmail.com',
            '4. Nombre: Eliecer P.',
          ],
          note: 'Mínimo $10 USD'
        };
      case 'cash':
        return {
          steps: [
            '1. Contacta al soporte',
            '2. Acuerda lugar de entrega',
            '3. Pago en efectivo',
          ],
          note: 'Solo disponible en Caracas'
        };
      case 'crypto':
        return {
          steps: [
            '1. Envía USDT (TRC20)',
            '2. Dirección: TXp8Y...MK3nH',
            '3. Ingresa el Hash de transacción abajo',
          ],
          note: 'Después de 1 confirmación, se acredita'
        };
      case 'airtm':
        return {
          steps: [
            '1. Envía a: payments@taktak.com',
            '2. Monto: $' + amount,
            '3. Ingresa el ID de Airtm abajo',
          ],
          note: 'Monto mínimo $5 USD'
        };
      case 'western_union':
        return {
          steps: [
            '1. Visita cualquier agencia WU',
            '2. Envía $' + amount + ' a: Elmalayaso - VE',
            '3. Ingresa el MTCN abajo',
          ],
          note: 'Verificación en 24h'
        };
      case 'banesco_ve':
        return {
          steps: [
            '1. Abre Banesco móvil',
            '2. Pago de servicios > TakTak',
            '3. Ingresa la referencia abajo',
          ],
          note: 'Solo clientes Banesco Venezuela'
        };
      case 'payoneer':
        return {
          steps: [
            '1. Envía $' + amount + ' a: business@taktak.com',
            '2. Ingresa el ID de transferencia abajo',
          ],
          note: 'Monto mínimo $50 USD'
        };
      case 'payeer':
        return {
          steps: [
            '1. Envía a la cuenta: P10293847',
            '2. Ingresa tu ID de Payeer y referencia abajo',
          ],
          note: 'Soporta Rublos y USD'
        };
      case 'zinli':
        return {
          steps: [
            '1. Abre tu app de Zinli',
            '2. Envía $' + amount + ' a: eliecerdepablos@gmail.com',
            '3. Ingresa la referencia de 10 dígitos abajo',
          ],
          note: 'Acreditación en menos de 10 minutos'
        };
      default:
        return { steps: ['Contacta soporte'], note: '' };
    }
  };

  const instructions = getPaymentInstructions();

  return (
    <div className="flex flex-col h-screen bg-black text-white">
      <div className={`p-6 ${method === 'stripe' ? 'bg-blue-600' : 'bg-green-600'}`}>
        <button 
          onClick={onClose} 
          className="p-2 hover:bg-white/10 rounded-full mb-4"
          aria-label="Volver"
          title="Volver"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="text-center">
          <CheckCircle className="w-16 h-16 mx-auto mb-2" />
          <p className="text-xl font-bold">{method === 'stripe' ? 'Pago con Tarjeta' : 'Validar Pago'}</p>
          <p className="text-3xl font-bold">${amount}</p>
        </div>
      </div>

      <div className="flex-1 p-6 overflow-y-auto pb-24">
        {method === 'stripe' ? (
          <div className="space-y-4">
            <div className="bg-zinc-900 rounded-xl p-4">
              <p className="text-zinc-400 text-sm mb-3">Datos de tu tarjeta</p>
              
              <div className="space-y-3">
                <Input
                  placeholder="1234 5678 9012 3456"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(formatCardNumber(e.target.value))}
                  maxLength={19}
                  className="bg-zinc-800 border-zinc-700"
                />
                <div className="flex gap-3">
                  <Input
                    placeholder="MM/YY"
                    value={cardExpiry}
                    onChange={(e) => setCardExpiry(formatExpiry(e.target.value))}
                    maxLength={5}
                    className="bg-zinc-800 border-zinc-700"
                  />
                  <Input
                    placeholder="CVC"
                    value={cardCvc}
                    onChange={(e) => setCardCvc(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    maxLength={4}
                    type="password"
                    className="bg-zinc-800 border-zinc-700"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 mt-4 text-zinc-500 text-xs">
                <Lock className="w-3 h-3" />
                <span>Encriptado con SSL - Stripe secure</span>
              </div>
            </div>

            <Button 
              onClick={handleSubmit} 
              disabled={isProcessing}
              className="w-full bg-blue-600 hover:bg-blue-700 py-4"
            >
              {isProcessing ? 'Procesando...' : `Pagar $${amount}`}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-zinc-900 rounded-xl p-4">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-3xl">{methodInfo?.icon}</span>
                <div>
                  <p className="font-semibold">{methodInfo?.name}</p>
                  <p className="text-zinc-500 text-sm">{methodInfo?.description}</p>
                </div>
              </div>

              <div className="space-y-2 border-l-2 border-green-500 pl-4 py-1">
                {instructions.steps.map((step, i) => (
                  <p key={i} className="text-white/80 text-sm leading-relaxed">{step}</p>
                ))}
              </div>

              <p className="text-green-400 text-[10px] mt-4 uppercase tracking-tighter">💡 {instructions.note}</p>
            </div>

            {needsReference && (
              <div className="bg-zinc-900 rounded-xl p-4 space-y-4">
                <p className="text-white font-bold text-sm">Comprobante de Pago</p>
                
                <div className="space-y-3">
                  <div>
                    <label className="text-zinc-500 text-[10px] uppercase mb-1 block">Número de Referencia / ID de Transacción</label>
                    <Input
                      placeholder="Ej: 123456789"
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                      className="bg-zinc-800 border-zinc-700"
                    />
                  </div>
                  <div>
                    <label className="text-zinc-500 text-[10px] uppercase mb-1 block">{senderLabel}</label>
                    <Input
                      placeholder="Para verificar tu envío"
                      value={senderInfo}
                      onChange={(e) => setSenderInfo(e.target.value)}
                      className="bg-zinc-800 border-zinc-700"
                    />
                  </div>
                </div>

                <div className="p-4 border-2 border-dashed border-zinc-800 rounded-xl text-center cursor-pointer hover:bg-zinc-800 transition-colors">
                  <QrCode className="w-8 h-8 mx-auto text-zinc-600 mb-2" />
                  <p className="text-zinc-500 text-xs text-balance">Haz clic para adjuntar captura de pantalla (opcional)</p>
                </div>
              </div>
            )}

            {(method === 'binance' || method === 'crypto') && (
              <div className="bg-white rounded-xl p-4 text-center">
                <QrCode className="w-32 h-32 mx-auto text-black" />
                <p className="text-black text-[10px] font-bold mt-2 uppercase">Lector QR Binance/Cripto</p>
              </div>
            )}

            <Button 
              onClick={handleSubmit} 
              disabled={isProcessing}
              className="w-full bg-green-600 hover:bg-green-700 py-6 text-lg font-bold shadow-lg shadow-green-500/10"
            >
              {isProcessing ? 'Enviando Datos...' : 'Enviar para Confirmar'}
            </Button>
          </div>
        )}

        <p className="text-zinc-600 text-[10px] text-center mt-6 uppercase tracking-widest">
          <Lock className="w-3 h-3 inline mr-1" />
          Seguridad de Grado Bancario Activa
        </p>
      </div>
    </div>
  );
};

export default PaymentView;
