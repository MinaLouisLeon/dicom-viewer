import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://mihawk-solutions.github.io',
  base: '/dicom-viewer',
  integrations: [
    starlight({
      title: 'DICOM Viewer',
      description: 'Documentation for the Mihawk Solutions React DICOM viewer.',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/mihawk-solutions/dicom-viewer' }],
      sidebar: [
        { label: 'Quickstart', slug: 'quickstart' },
        { label: 'Viewer API', slug: 'api' },
        { label: 'Workstation (full app)', slug: 'workstation' },
        { label: 'Troubleshooting', slug: 'troubleshooting' },
        { label: 'Open demo (new tab)', link: '/demo/', attrs: { target: '_blank', rel: 'noopener' } },
      ],
    }),
  ],
});
