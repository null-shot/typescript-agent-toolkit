import { useState } from 'react';

type Operator = '+' | '-' | '×' | '÷' | null;

export default function Calculator() {
	const [display, setDisplay] = useState('0');
	const [expression, setExpression] = useState('');
	const [previousValue, setPreviousValue] = useState<number | null>(null);
	const [operator, setOperator] = useState<Operator>(null);
	const [waitingForOperand, setWaitingForOperand] = useState(false);

	const handleNumber = (num: string) => {
		if (waitingForOperand) {
			setDisplay(num);
			setWaitingForOperand(false);
		} else {
			setDisplay(display === '0' ? num : display + num);
		}
	};

	const handleDecimal = () => {
		if (waitingForOperand) {
			setDisplay('0.');
			setWaitingForOperand(false);
		} else if (!display.includes('.')) {
			setDisplay(display + '.');
		}
	};

	const calculate = (firstValue: number, secondValue: number, op: Operator): number => {
		switch (op) {
			case '+': return firstValue + secondValue;
			case '-': return firstValue - secondValue;
			case '×': return firstValue * secondValue;
			case '÷': return secondValue !== 0 ? firstValue / secondValue : NaN;
			default:  return secondValue;
		}
	};

	const formatNumber = (n: string) => {
		const num = parseFloat(n);
		if (isNaN(num)) return 'Error';
		if (!isFinite(num)) return '∞';
		return n;
	};

	const handleOperator = (nextOperator: Operator) => {
		const inputValue = parseFloat(display);

		if (previousValue === null) {
			setPreviousValue(inputValue);
			setExpression(`${display} ${nextOperator}`);
		} else if (operator) {
			const newValue = calculate(previousValue, inputValue, operator);
			const formatted = String(newValue);
			setDisplay(formatted);
			setPreviousValue(newValue);
			setExpression(`${formatted} ${nextOperator}`);
		}

		setWaitingForOperand(true);
		setOperator(nextOperator);
	};

	const handleEquals = () => {
		const inputValue = parseFloat(display);

		if (previousValue !== null && operator) {
			const newValue = calculate(previousValue, inputValue, operator);
			setExpression(`${previousValue} ${operator} ${display} =`);
			setDisplay(String(newValue));
			setPreviousValue(null);
			setOperator(null);
			setWaitingForOperand(true);
		}
	};

	const handleClear = () => {
		setDisplay('0');
		setExpression('');
		setPreviousValue(null);
		setOperator(null);
		setWaitingForOperand(false);
	};

	const handleBackspace = () => {
		if (waitingForOperand) return;
		setDisplay(display.length > 1 ? display.slice(0, -1) : '0');
	};

	type Variant = 'digit' | 'operator' | 'equals' | 'clear' | 'action';

	const Button = ({
		children,
		onClick,
		variant = 'digit',
		wide = false,
	}: {
		children: React.ReactNode;
		onClick: () => void;
		variant?: Variant;
		wide?: boolean;
	}) => {
		const base =
			'flex items-center justify-center rounded-2xl text-lg font-semibold transition-all duration-100 select-none cursor-pointer active:scale-95 focus:outline-none';

		const variants: Record<Variant, string> = {
			digit:
				'bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm border border-white/10 hover:border-white/20 shadow-sm',
			operator:
				'bg-cyan-500/20 hover:bg-cyan-500/35 text-cyan-300 border border-cyan-400/25 hover:border-cyan-400/50 shadow-sm',
			equals:
				'bg-gradient-to-br from-cyan-400 to-teal-500 hover:from-cyan-300 hover:to-teal-400 text-gray-900 font-bold shadow-lg shadow-cyan-500/30',
			clear:
				'bg-rose-500/20 hover:bg-rose-500/35 text-rose-300 border border-rose-400/25 hover:border-rose-400/50',
			action:
				'bg-white/6 hover:bg-white/14 text-white/60 hover:text-white/90 border border-white/8 text-base',
		};

		return (
			<button
				onClick={onClick}
				className={`${base} ${variants[variant]} ${wide ? 'col-span-2' : ''} h-16`}
			>
				{children}
			</button>
		);
	};

	const displayText = formatNumber(display);
	const displaySize =
		displayText.length > 12 ? 'text-2xl' :
		displayText.length > 8  ? 'text-3xl' :
		displayText.length > 5  ? 'text-4xl' : 'text-5xl';

	return (
		<div
			style={{
				background: 'rgba(15, 15, 30, 0.7)',
				backdropFilter: 'blur(24px)',
				WebkitBackdropFilter: 'blur(24px)',
				border: '1px solid rgba(255,255,255,0.08)',
				boxShadow: '0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset',
			}}
			className="w-full max-w-sm mx-auto rounded-3xl p-5"
		>
			{/* Display */}
			<div className="mb-4 rounded-2xl px-5 pt-5 pb-4" style={{ background: 'rgba(0,0,0,0.3)' }}>
				{/* Expression */}
				<div className="text-right text-sm font-medium mb-2 min-h-[20px] truncate" style={{ color: 'rgba(255,255,255,0.35)' }}>
					{expression || '\u00A0'}
				</div>
				{/* Main number */}
				<div className={`text-right font-bold text-white break-all min-h-[60px] flex items-center justify-end ${displaySize}`}>
					{displayText}
				</div>
				{/* Active operator indicator */}
				<div className="flex justify-end mt-2 gap-1 min-h-[16px]">
					{(['÷','×','-','+'] as Operator[]).map(op => (
						<span
							key={op!}
							className={`text-xs px-1.5 py-0.5 rounded font-bold transition-all duration-150 ${
								operator === op
									? 'bg-cyan-400/25 text-cyan-300'
									: 'text-transparent'
							}`}
						>
							{op}
						</span>
					))}
				</div>
			</div>

			{/* Button Grid */}
			<div className="grid grid-cols-4 gap-2.5">
				<Button onClick={handleClear} variant="clear" wide>AC</Button>
				<Button onClick={handleBackspace} variant="action">⌫</Button>
				<Button onClick={() => handleOperator('÷')} variant="operator">÷</Button>

				<Button onClick={() => handleNumber('7')} variant="digit">7</Button>
				<Button onClick={() => handleNumber('8')} variant="digit">8</Button>
				<Button onClick={() => handleNumber('9')} variant="digit">9</Button>
				<Button onClick={() => handleOperator('×')} variant="operator">×</Button>

				<Button onClick={() => handleNumber('4')} variant="digit">4</Button>
				<Button onClick={() => handleNumber('5')} variant="digit">5</Button>
				<Button onClick={() => handleNumber('6')} variant="digit">6</Button>
				<Button onClick={() => handleOperator('-')} variant="operator">−</Button>

				<Button onClick={() => handleNumber('1')} variant="digit">1</Button>
				<Button onClick={() => handleNumber('2')} variant="digit">2</Button>
				<Button onClick={() => handleNumber('3')} variant="digit">3</Button>
				<Button onClick={() => handleOperator('+')} variant="operator">+</Button>

				<Button onClick={() => handleNumber('0')} variant="digit" wide>0</Button>
				<Button onClick={handleDecimal} variant="digit">.</Button>
				<Button onClick={handleEquals} variant="equals">=</Button>
			</div>
		</div>
	);
}
