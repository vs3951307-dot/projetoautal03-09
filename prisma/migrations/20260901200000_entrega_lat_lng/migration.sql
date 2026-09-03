-- Localização nativa do WhatsApp salva na entrega do pedido
ALTER TABLE "Entrega" ADD COLUMN IF NOT EXISTS "latitude" DOUBLE PRECISION;
ALTER TABLE "Entrega" ADD COLUMN IF NOT EXISTS "longitude" DOUBLE PRECISION;
