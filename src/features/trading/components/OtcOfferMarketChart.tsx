import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type OtcOfferMarketChartProps = Readonly<{
  marketPrice: number | null;
  orderPrice: number | null;
  baseSymbol: string;
  quoteSymbol: string;
}>;

const formatPrice = (value: number): string => new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 8,
  maximumSignificantDigits: 8
}).format(value);

const ILLUSTRATIVE_MARKET_OFFSETS = [
  -0.028, -0.016, -0.022, -0.006, 0.004, -0.003,
  0.012, 0.008, 0.018, 0.011, 0.006, 0
] as const;

const buildIllustrativeMarketHistory = (marketPrice: number | null) => marketPrice === null
  ? []
  : ILLUSTRATIVE_MARKET_OFFSETS.map((offset, index) => ({
      period: index === 0 ? '90D' : index === ILLUSTRATIVE_MARKET_OFFSETS.length - 1 ? 'Now' : '',
      market: marketPrice * (1 + offset)
    }));

export default function OtcOfferMarketChart({
  marketPrice,
  orderPrice,
  baseSymbol,
  quoteSymbol
}: OtcOfferMarketChartProps) {
  const data = buildIllustrativeMarketHistory(marketPrice);
  const prices = [
    ...data.map(({ market }) => market),
    orderPrice
  ].filter((price): price is number => price !== null && price > 0);
  if (prices.length === 0) {
    return (
      <div className="p2p-offers-chart-empty" role="status">
        Market reference and offer price are unavailable for this pair.
      </div>
    );
  }

  const minimum = Math.min(...prices);
  const maximum = Math.max(...prices);
  const padding = Math.max((maximum - minimum) * 0.2, maximum * 0.01);

  return (
    <div className="p2p-offers-chart-body">
      <div className="p2p-offers-chart-legend">
        <span className="is-market">Illustrative market history {marketPrice === null ? '—' : formatPrice(marketPrice)}</span>
        <span className="is-order">Selected offer {orderPrice === null ? '—' : formatPrice(orderPrice)}</span>
      </div>
      <div className="p2p-offers-chart-plot" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 58, bottom: 10, left: 6 }}>
            <XAxis
              dataKey="period"
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#81789f', fontSize: 10 }}
            />
            <YAxis
              orientation="right"
              domain={[Math.max(0, minimum - padding), maximum + padding]}
              tickFormatter={(value) => formatPrice(Number(value))}
              axisLine={false}
              tickLine={false}
              tick={{ fill: '#81789f', fontSize: 10 }}
              width={52}
            />
            <Tooltip formatter={(value) => `${formatPrice(Number(value))} ${quoteSymbol}`} />
            {marketPrice !== null ? (
              <Line className="p2p-offers-chart-history-line" type="monotone" dataKey="market" stroke="#22d3ee" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            ) : null}
            {orderPrice !== null ? (
              <ReferenceLine className="p2p-offers-chart-order-line" y={orderPrice} stroke="#c084fc" strokeWidth={1.5} strokeDasharray="5 4" />
            ) : null}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p>
        Illustrative history for the current pair — live Carbon history is not connected yet. The dashed line is the selected offer price for 1 {baseSymbol} in {quoteSymbol}.
      </p>
    </div>
  );
}
