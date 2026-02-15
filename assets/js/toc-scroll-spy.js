// Documentation-Style TOC Scroll Spy
// Matches Google Cloud Docs / Mintlify behavior
(function() {
  'use strict';

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initScrollSpy);
  } else {
    initScrollSpy();
  }

  function initScrollSpy() {
    const toc = document.querySelector('.toc');
    if (!toc) return;

    // Force TOC to be open
    const tocDetails = toc.querySelector('details');
    if (tocDetails) {
      tocDetails.open = true;
    }

    const tocLinks = Array.from(toc.querySelectorAll('a'));
    if (tocLinks.length === 0) return;

    // Get all headings with IDs
    const headings = Array.from(
      document.querySelectorAll('.post-content h1[id], .post-content h2[id], .post-content h3[id], .post-content h4[id], .post-content h5[id], .post-content h6[id]')
    ).filter(heading => {
      // Only include headings that are in the TOC
      return tocLinks.some(link => link.getAttribute('href') === `#${heading.id}`);
    });

    if (headings.length === 0) return;

    let activeLink = null;

    function updateActiveLink() {
      // Get scroll position with offset
      const scrollPosition = window.scrollY + 120;
      
      // Find the current heading
      let currentHeading = null;
      
      for (let i = headings.length - 1; i >= 0; i--) {
        const heading = headings[i];
        if (heading.offsetTop <= scrollPosition) {
          currentHeading = heading;
          break;
        }
      }

      // Fallback to first heading if we're at the top
      if (!currentHeading && scrollPosition < headings[0].offsetTop) {
        currentHeading = headings[0];
      }

      if (!currentHeading) return;

      // Find corresponding TOC link
      const targetLink = toc.querySelector(`a[href="#${currentHeading.id}"]`);

      if (targetLink && targetLink !== activeLink) {
        // Remove previous active state
        tocLinks.forEach(link => link.classList.remove('active'));
        
        // Add new active state
        targetLink.classList.add('active');
        activeLink = targetLink;

        // Keep active item visible in TOC (desktop only)
        if (window.innerWidth >= 1280) {
          const tocRect = toc.getBoundingClientRect();
          const linkRect = targetLink.getBoundingClientRect();
          
          // Check if link is outside visible area
          if (linkRect.bottom > tocRect.bottom - 20 || linkRect.top < tocRect.top + 20) {
            targetLink.scrollIntoView({ 
              block: 'nearest', 
              behavior: 'smooth',
              inline: 'nearest'
            });
          }
        }
      }
    }

    // Throttle scroll for performance
    let ticking = false;
    function onScroll() {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          updateActiveLink();
          ticking = false;
        });
        ticking = true;
      }
    }

    // Initialize
    updateActiveLink();

    // Event listeners
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', updateActiveLink, { passive: true });

    // Smooth scroll on TOC link click
    tocLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        const targetId = link.getAttribute('href').substring(1);
        const targetElement = document.getElementById(targetId);
        
        if (targetElement) {
          e.preventDefault();
          const offsetTop = targetElement.offsetTop - 100;
          window.scrollTo({
            top: offsetTop,
            behavior: 'smooth'
          });
        }
      });
    });
  }
})();
