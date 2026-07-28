/**
 * Mobile Performance Optimizations for KickALL
 * Enhances mobile experience with performance improvements and gestures
 */

// Disable console logs in production
if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    console.log = function() {};
    console.warn = function() {};
    console.error = function() {};
    console.info = function() {};
    console.debug = function() {};
}

(function() {
    'use strict';

    // Feature detection
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isAndroid = /Android/.test(navigator.userAgent);

    // Mobile-specific optimizations
    if (isMobile || isTouchDevice) {
        
        // 1. Prevent zoom on input focus (iOS)
        if (isIOS) {
            const metaViewport = document.querySelector('meta[name="viewport"]');
            if (metaViewport) {
                metaViewport.setAttribute('content', 
                    'width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes, viewport-fit=cover');
            }
        }

        // 2. Optimize images for mobile
        function optimizeImages() {
            const images = document.querySelectorAll('img');
            images.forEach(img => {
                // Add loading="lazy" to below-fold images
                if (img.getBoundingClientRect().top > window.innerHeight) {
                    img.loading = 'lazy';
                }
                
                // Use WebP if supported
                if (img.src.endsWith('.png') || img.src.endsWith('.jpg')) {
                    const webpSrc = img.src.replace(/\.(png|jpg)$/, '.webp');
                    // Check if WebP version exists
                    fetch(webpSrc, { method: 'HEAD' })
                        .then(response => {
                            if (response.ok) {
                                img.src = webpSrc;
                            }
                        })
                        .catch((error) => {
                            // Silently fail - WebP optimization is optional
                            console.debug('WebP optimization failed for:', img.src, error);
                        });
                }
            });
        }

        // 3. Lazy load images
        if ('IntersectionObserver' in window) {
            const imageObserver = new IntersectionObserver((entries, observer) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        if (img.dataset.src) {
                            img.src = img.dataset.src;
                            img.removeAttribute('data-src');
                        }
                        observer.unobserve(img);
                    }
                });
            });

            document.querySelectorAll('img[data-src]').forEach(img => {
                imageObserver.observe(img);
            });
        }

        // 4. Optimize animations for mobile
        function optimizeAnimations() {
            // Reduce animation complexity on mobile - only specific elements
            const style = document.createElement('style');
            style.textContent = `
                @media (max-width: 768px) {
                    .blob {
                        animation-duration: 10s !important;
                        opacity: 0.12 !important;
                    }
                    
                    .glow-bg {
                        will-change: transform;
                        backface-visibility: hidden;
                        perspective: 1000px;
                    }
                }
            `;
            document.head.appendChild(style);
        }

        // 5. Prevent pull-to-refresh on sensitive areas
        function preventPullToRefresh() {
            const sensitiveElements = document.querySelectorAll('.dashboard-content, .sidebar, .no-pull-refresh');
            sensitiveElements.forEach(element => {
                element.style.overscrollBehavior = 'contain';
            });
        }

        // 6. Optimize touch events
        function optimizeTouchEvents() {
            // Add touch feedback to buttons
            const buttons = document.querySelectorAll('.btn, .nav-link, .mobile-toggle');
            buttons.forEach(button => {
                button.addEventListener('touchstart', function() {
                    this.style.transform = 'scale(0.95)';
                }, { passive: true });
                
                button.addEventListener('touchend', function() {
                    this.style.transform = 'scale(1)';
                }, { passive: true });
            });
        }

        // 7. Implement smooth scroll with momentum
        function enableSmoothScroll() {
            if ('scrollBehavior' in document.documentElement.style) {
                document.documentElement.style.scrollBehavior = 'smooth';
            }
            
            // iOS momentum scrolling
            if (isIOS) {
                document.body.style.webkitOverflowScrolling = 'touch';
            }
        }

        // 8. Optimize font loading
        function optimizeFontLoading() {
            if ('fonts' in document) {
                document.fonts.ready.then(() => {
                    document.body.classList.add('fonts-loaded');
                });
            }
        }

        // 9. Debounce resize events
        function debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        }

        // 10. Optimize scroll events
        let ticking = false;
        function onScroll() {
            if (!ticking) {
                window.requestAnimationFrame(() => {
                    // Handle scroll-based optimizations
                    ticking = false;
                });
                ticking = true;
            }
        }

        window.addEventListener('scroll', onScroll, { passive: true });

        // 11. Memory management
        function cleanup() {
            // Remove event listeners and clean up resources
            window.removeEventListener('scroll', onScroll);
        }

        // 12. Gesture support (swipe detection)
        let touchStartX = 0;
        let touchStartY = 0;
        let touchEndX = 0;
        let touchEndY = 0;

        function handleSwipe() {
            const swipeThreshold = 50;
            const diffX = touchEndX - touchStartX;
            const diffY = touchEndY - touchStartY;

            if (Math.abs(diffX) > Math.abs(diffY)) {
                // Horizontal swipe
                if (Math.abs(diffX) > swipeThreshold) {
                    if (diffX > 0) {
                        // Swipe right
                        document.dispatchEvent(new CustomEvent('swiperight'));
                    } else {
                        // Swipe left
                        document.dispatchEvent(new CustomEvent('swipeleft'));
                    }
                }
            } else {
                // Vertical swipe
                if (Math.abs(diffY) > swipeThreshold) {
                    if (diffY > 0) {
                        // Swipe down
                        document.dispatchEvent(new CustomEvent('swipedown'));
                    } else {
                        // Swipe up
                        document.dispatchEvent(new CustomEvent('swipeup'));
                    }
                }
            }
        }

        document.addEventListener('touchstart', (e) => {
            touchStartX = e.changedTouches[0].screenX;
            touchStartY = e.changedTouches[0].screenY;
        }, { passive: true });

        document.addEventListener('touchend', (e) => {
            touchEndX = e.changedTouches[0].screenX;
            touchEndY = e.changedTouches[0].screenY;
            // Only handle swipe if it's a clear horizontal gesture (not scroll)
            const diffX = touchEndX - touchStartX;
            const diffY = touchEndY - touchStartY;
            if (Math.abs(diffX) > Math.abs(diffY) * 2) {
                handleSwipe();
            }
        }, { passive: true });

        // 13. Network awareness
        function handleNetworkChange() {
            const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            if (connection) {
                const effectiveType = connection.effectiveType;
                
                if (effectiveType === 'slow-2g' || effectiveType === '2g') {
                    // Reduce image quality and disable animations on slow connections
                    document.body.classList.add('slow-connection');
                }
                
                connection.addEventListener('change', handleNetworkChange);
            }
        }

        // 14. Battery awareness
        if ('getBattery' in navigator) {
            navigator.getBattery().then(battery => {
                function updateBatteryStatus() {
                    if (battery.level < 0.2 && !battery.charging) {
                        // Reduce animations and background tasks on low battery
                        document.body.classList.add('low-battery');
                    }
                }
                
                updateBatteryStatus();
                battery.addEventListener('levelchange', updateBatteryStatus);
                battery.addEventListener('chargingchange', updateBatteryStatus);
            });
        }

        // 15. Viewport orientation handling
        function handleOrientationChange() {
            const orientation = window.screen.orientation.type;
            document.body.classList.remove('portrait', 'landscape');
            
            if (orientation === 'portrait-primary' || orientation === 'portrait-secondary') {
                document.body.classList.add('portrait');
            } else {
                document.body.classList.add('landscape');
            }
        }

        window.addEventListener('orientationchange', handleOrientationChange);

        // Initialize all optimizations
        function init() {
            optimizeImages();
            optimizeAnimations();
            preventPullToRefresh();
            optimizeTouchEvents();
            enableSmoothScroll();
            optimizeFontLoading();
            handleNetworkChange();
            handleOrientationChange();
            
            // Run cleanup on page unload
            window.addEventListener('beforeunload', cleanup);
        }

        // Run when DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }

        // Export performance metrics for debugging
        window.KickALLMobile = {
            performanceMetrics: {}, // Placeholder for future metrics collection
            isMobile,
            isTouchDevice,
            isIOS,
            isAndroid
        };
    }
})();
