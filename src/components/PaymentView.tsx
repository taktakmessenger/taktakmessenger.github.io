import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  QrCode, Lock, ArrowLeft, Gift, CheckCircle, Crown
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
  { id: 'zelle', name: 'Zelle', icon: '💚', description: 'Pago instantáneo desde tu banco' },
  { id: 'binance', name: 'Binance Pay', icon: '🟡', description: 'Criptomonedas seguras' },
  { id: 'pago_movil', name: 'Pago Móvil', icon: '📱', description: 'Venezuela - Banesco/Provincial' },
  { id: 'zelle_banesco', name: 'Zelle Banesco', icon: '🏦', description: 'Desde $10 USD' },
  { id: 'cash', name: 'Efectivo', icon: '💵', description: 'Pago presencial' },
  { id: 'crypto', name: 'Criptomonedas', icon: '₿', description: 'BTC, USDT, ETH' },
  { id: 'airtm', name: 'Airtm', icon: '🌐', description: 'Bolsas locales Venezuela' },
  { id: 'western_union', name: 'Western Union', icon: '🌎', description: 'Envíos internacionales' },
  { id: 'banesco_ve', name: 'Banesco Online', icon: '🏦', description: 'Pagos desde Venezuela' },
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
  const { balance, addBalance } = useStore();
  const [activeTab, setActiveTab] = useState<'recharge' | 'buy' | 'subscription'>('recharge');
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
      addBalance(value);
      setIsProcessing(false);
      setShowPaymentDetails(true);
      toast.success(`¡Recarga de $${value} exitosa!`);
    }, 2000);
  };

  const handlePackageBuy = (pkg: typeof packages[0]) => {
    setIsProcessing(true);
    
    setTimeout(() => {
      addBalance(pkg.credits);
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
          <button onClick={() => window.history.back()} className="p-2 hover:bg-white/10 rounded-full">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-bold">Billetera</h1>
          <div className="w-10" />
        </div>
        
        <div className="text-center">
          <p className="text-white/70 text-sm">Saldo disponible</p>
          <p className="text-4xl font-bold">${balance.toFixed(2)}</p>
          <p className="text-white/70 text-xs">USD</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800">
        <button
          onClick={() => setActiveTab('recharge')}
          className={`flex-1 py-3 text-sm font-medium ${activeTab === 'recharge' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-zinc-500'}`}
        >
          Recargar
        </button>
        <button
          onClick={() => setActiveTab('buy')}
          className={`flex-1 py-3 text-sm font-medium ${activeTab === 'buy' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-zinc-500'}`}
        >
          Paquetes
        </button>
        <button
          onClick={() => setActiveTab('subscription')}
          className={`flex-1 py-3 text-sm font-medium ${activeTab === 'subscription' ? 'text-purple-400 border-b-2 border-purple-400' : 'text-zinc-500'}`}
        >
          Premium
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'recharge' && (
          <div className="space-y-4">
            {/* Amount Input */}
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

            {/* Payment Methods */}
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
                        ? 'bg-purple-500/20 border-2 border-purple-500'
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
              className="w-full bg-gradient-to-r from-purple-500 to-pink-500 py-4 text-lg"
            >
              {isProcessing ? (
                <span className="flex items-center gap-2">
                  <Lock className="w-4 h-4 animate-spin" />
                  Procesando...
                </span>
              ) : (
                `Recargar $${amount || '0'}`
              )}
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
                  pkg.popular ? 'bg-purple-500/20 border-2 border-purple-500' : 'bg-zinc-900'
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    pkg.popular ? 'bg-purple-500' : 'bg-zinc-800'
                  }`}>
                    <Gift className={`w-6 h-6 ${pkg.popular ? 'text-white' : 'text-zinc-400'}`} />
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
                    className="mt-1 bg-purple-500 hover:bg-purple-600"
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
                  className="w-full bg-yellow-500 hover:bg-yellow-600 text-black"
                >
                  {isProcessing ? 'Activando...' : 'Suscribirse'}
                </Button>
              </motion.div>
            ))}
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
  const [isProcessing, setIsProcessing] = useState(false);

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

  const handleStripeSubmit = () => {
    if (!cardNumber || !cardExpiry || !cardCvc) {
      toast.error('Completa todos los datos de la tarjeta');
      return;
    }
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      toast.success('¡Pago procesado! Saldo acreditado');
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
            '3. Envía el comprobante aquí',
          ],
          note: 'El saldo se acreditará en 5-15 minutos'
        };
      case 'binance':
        return {
          steps: [
            '1. Abre Binance y ve a Pagos',
            '2. Escanea el código QR',
            '3. Envía USDT a la dirección mostrada',
          ],
          note: 'Dirección TRC20: TXm7Y8...'
        };
      case 'pago_movil':
        return {
          steps: [
            '1. Envía $' + amount + ' por Pago Móvil',
            '2. Teléfono: +58 412-1234567',
            '3. Banco: Banesco',
          ],
          note: 'Envía captura del pago'
        };
      case 'zelle_banesco':
        return {
          steps: [
            '1. Envía $' + amount + ' por Zelle',
            '2. Email: eliecerdepablos@gmail.com',
            '3. Nombre: Eliecer P.',
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
            '3. Envía exactamente: ' + amount + ' USDT',
          ],
          note: 'Después de 1 confirmación, se acredita'
        };
      case 'airtm':
        return {
          steps: [
            '1. Crea cuenta en Airtm.com',
            '2. Compra USD con Bs en Venezuela',
            '3. Envía a: payments@taktak.com',
          ],
          note: 'Monto mínimo $5 USD'
        };
      case 'western_union':
        return {
          steps: [
            '1. Visita cualquier agencia WU',
            '2. Envía $' + amount + ' a nombre de:',
            '3. Eliecer P. - Venezuela',
          ],
          note: 'Envía el MTCN inmediatamente'
        };
      case 'banesco_ve':
        return {
          steps: [
            '1. Abre Banesco móvil',
            '2. Pago de servicios > TakTak',
            '3. Ingresa: $' + amount,
          ],
          note: 'Solo clientes Banesco Venezuela'
        };
      default:
        return { steps: ['Contacta soporte'], note: '' };
    }
  };

  const instructions = getPaymentInstructions();

  return (
    <div className="flex flex-col h-screen bg-black text-white">
      <div className={`p-6 ${method === 'stripe' ? 'bg-blue-600' : 'bg-green-600'}`}>
        <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full mb-4">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="text-center">
          <CheckCircle className="w-16 h-16 mx-auto mb-2" />
          <p className="text-xl font-bold">{method === 'stripe' ? 'Pago con Tarjeta' : 'Pago iniciado'}</p>
          <p className="text-3xl font-bold">${amount}</p>
        </div>
      </div>

      <div className="flex-1 p-6">
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

            <div className="bg-zinc-900 rounded-xl p-4">
              <p className="text-zinc-400 text-sm mb-2">Métodos aceptados:</p>
              <div className="flex gap-2 text-2xl">💳 📱 🏦</div>
              <p className="text-zinc-500 text-xs mt-2">Visa, Mastercard, American Express</p>
            </div>

            <Button 
              onClick={handleStripeSubmit} 
              disabled={isProcessing}
              className="w-full bg-blue-600 hover:bg-blue-700 py-4"
            >
              {isProcessing ? 'Procesando...' : `Pagar $${amount}`}
            </Button>
          </div>
        ) : (
          <div>
            <div className="bg-zinc-900 rounded-xl p-4 mb-4">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-3xl">{methodInfo?.icon}</span>
                <div>
                  <p className="font-semibold">{methodInfo?.name}</p>
                  <p className="text-zinc-500 text-sm">{methodInfo?.description}</p>
                </div>
              </div>

              <div className="space-y-2">
                {instructions.steps.map((step, i) => (
                  <p key={i} className="text-white/80 text-sm">{step}</p>
                ))}
              </div>

              <p className="text-green-400 text-sm mt-4">💡 {instructions.note}</p>
            </div>

            {(method === 'binance' || method === 'crypto') && (
              <div className="bg-white rounded-xl p-4 text-center mb-4">
                <QrCode className="w-32 h-32 mx-auto text-black" />
                <p className="text-black text-sm mt-2">Escanea para pagar</p>
              </div>
            )}

            <Button onClick={onClose} className="w-full bg-green-600 hover:bg-green-700 py-4">
              Ya realicé el pago
            </Button>
          </div>
        )}

        <p className="text-zinc-500 text-xs text-center mt-4">
          <Lock className="w-3 h-3 inline mr-1" />
          Tus pagos están seguros y encriptados
        </p>
      </div>
    </div>
  );
};

export default PaymentView;
