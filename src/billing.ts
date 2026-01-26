import { registerPlugin } from '@capacitor/core'

export type BillingProductId = 'heart_1' | 'heart_3' | 'heart_1h' | 'heart_24h' | 'heart_30d'

export interface BillingProduct {
  productId: BillingProductId
  title: string
  description?: string
  price: string
  currency?: string
}

export interface BillingPurchase {
  productId: BillingProductId
  purchaseToken: string
  acknowledged?: boolean
}

export interface BillingPlugin {
  initialize(): Promise<{ ok: boolean }>
  getProducts(options: { productIds: BillingProductId[] }): Promise<{ products: BillingProduct[] }>
  purchase(options: { productId: BillingProductId }): Promise<BillingPurchase>
  restore(): Promise<{ purchases: BillingPurchase[] }>
}

const Billing = registerPlugin<BillingPlugin>('Billing', {
  web: () => ({
    async initialize() {
      return { ok: false }
    },
    async getProducts() {
      return { products: [] }
    },
    async purchase() {
      throw new Error('Billing not available on web build')
    },
    async restore() {
      return { purchases: [] }
    }
  })
})

export const PRODUCT_CATALOG: Record<BillingProductId, BillingProduct> = {
  heart_1: { productId: 'heart_1', title: '1 Heart', price: '$1' },
  heart_3: { productId: 'heart_3', title: '3 Hearts', price: '$3' },
  heart_1h: { productId: 'heart_1h', title: '1 Hour Unlimited', price: '$5' },
  heart_24h: { productId: 'heart_24h', title: '24 Hours Unlimited', price: '$10' },
  heart_30d: { productId: 'heart_30d', title: '30 Days Unlimited', price: '$20' }
}

let initialized = false

export async function ensureBillingReady() {
  if (initialized) return
  try {
    await Billing.initialize()
    initialized = true
  } catch (err) {
    // Silently fail on web platform
  }
}

export async function purchaseProduct(productId: BillingProductId): Promise<BillingPurchase> {
  if (!initialized) {
    await ensureBillingReady()
  }
  return Billing.purchase({ productId })
}

export async function restorePurchases(): Promise<BillingPurchase[]> {
  if (!initialized) await ensureBillingReady()
  const res = await Billing.restore()
  return res.purchases ?? []
}

