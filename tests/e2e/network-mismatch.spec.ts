import { expect, test } from '@playwright/test'

const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015'
const MAINNET_PASSPHRASE = 'Public Global Stellar Network ; September 2015'
const CONTRACT_ID = 'CDP5XZ7UYCGSQBYRDYM2OEAUQJULBZPULSQXK7LGNAJTRXRG3VHZLSHY'

const mismatches = [
  {
    name: 'testnet build with a mainnet wallet',
    walletNetwork: MAINNET_PASSPHRASE,
    targetNetwork: 'testnet',
  },
  {
    name: 'mainnet build with a testnet wallet',
    walletNetwork: TESTNET_PASSPHRASE,
    targetNetwork: 'mainnet',
  },
] as const

for (const scenario of mismatches) {
  test(`blocks ${scenario.name}`, async ({ page }) => {
    await page.goto('/')
    await page.evaluate(async (props) => {
      const [React, { createRoot }, { WalletNetworkGate }] = await Promise.all([
        import('react'),
        import('react-dom/client'),
        import('/src/contexts/WalletContext.tsx'),
      ])
      const host = document.createElement('div')
      document.body.append(host)
      createRoot(host).render(
        React.createElement(
          WalletNetworkGate,
          {
            isConnected: true,
            walletNetwork: props.walletNetwork,
            targetNetwork: props.targetNetwork,
            manifestNetwork: props.targetNetwork,
            contractId: props.contractId,
          },
          React.createElement('button', null, 'Send / claim'),
        ),
      )
    }, { ...scenario, contractId: CONTRACT_ID })

    await expect(page.getByRole('heading', { name: 'Wrong network' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send / claim' })).not.toBeVisible()
  })
}
