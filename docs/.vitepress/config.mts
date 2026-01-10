import { defineConfig } from 'vitepress'

export default defineConfig({
    title: "Tobari",
    description: "Trust Infrastructure Toolkit for the AI Agent era",
    base: '/tobari/',
    ignoreDeadLinks: true,
    themeConfig: {
        nav: [
            { text: 'Home', link: '/' },
            { text: 'Core', link: '/ARCHITECTURE' },
            { text: 'Civ', link: '/civ/IDENTITY_SCHEME_ANALYSIS' },
            { text: 'Examples', link: 'https://github.com/masanork/tobari/tree/main/examples' }
        ],

        sidebar: [
            {
                text: 'Introduction',
                items: [
                    { text: 'Architecture', link: '/ARCHITECTURE' },
                    { text: 'Getting Started', link: '/README' } // Will map to project README if copied or linked
                ]
            },
            {
                text: 'Core Specs',
                items: [
                    { text: 'Schema Spec', link: '/SCHEMA_SPEC' },
                    { text: 'Holder Binding', link: '/HOLDER_BINDING' },
                    { text: 'Encryption & Consent', link: '/ENCRYPTION_STRATEGY' },
                    { text: 'Long-Term Validation', link: '/LONG_TERM_VALIDATION' },
                    { text: 'CWOC Spec', link: '/CWOC_SPEC' },
                    { text: 'FATF Analysis', link: '/FATF_ANALYSIS' }
                ]
            },
            {
                text: 'Civ (Identity Lib)',
                collapsed: false,
                items: [
                    { text: 'Scheme Analysis', link: '/civ/IDENTITY_SCHEME_ANALYSIS' },
                    { text: 'JPKI', link: '/civ/jpki' },
                    { text: 'JPDL (License)', link: '/civ/jpdl' },
                    { text: 'MyNa-Menkyo', link: '/civ/jpdlmnc' },
                    { text: 'Residence Card', link: '/civ/jprc' },
                    { text: 'Passport', link: '/civ/icao9303' },
                    { text: 'Thai ID', link: '/civ/thai' },
                    { text: 'MyKad', link: '/civ/mykad' },
                    { text: 'PIV (USA)', link: '/civ/piv' }
                ]
            },
            {
                text: 'Guides',
                items: [
                    { text: 'CLI Tools', link: '/CLI_TOOLS' },
                    { text: 'MCP Server', link: '/MCP_SERVER' },
                    { text: 'Tutorial', link: '/SERVICE_REQUEST_TUTORIAL' }
                ]
            }
        ],

        socialLinks: [
            { icon: 'github', link: 'https://github.com/masanork/tobari' }
        ],

        search: {
            provider: 'local'
        },

        footer: {
            message: 'Released under the MIT License.',
            copyright: 'Copyright © 2024-present Tobari Project'
        },

        editLink: {
            pattern: 'https://github.com/masanork/tobari/edit/main/:path',
            text: 'Edit this page on GitHub'
        },

        lastUpdated: {
            text: 'Updated at',
            formatOptions: {
                dateStyle: 'full',
                timeStyle: 'short'
            }
        }
    },
    lastUpdated: true,
    markdown: {
        theme: {
            light: 'github-light',
            dark: 'github-dark'
        }
    }
})
