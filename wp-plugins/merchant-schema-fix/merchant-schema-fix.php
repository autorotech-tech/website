<?php
/**
 * Plugin Name: Merchant Schema Fix
 * Plugin URI: https://autoro.tech
 * Description: Independent JSON-LD schema fixer for Google Merchant Center compliance. Works with any SEO plugin (RankMath, Yoast, WooCommerce native).
 * Version: 1.0.0
 * Author: Autoro.tech
 * Author URI: https://autoro.tech
 * License: GPL-2.0+
 * Requires PHP: 7.4
 * Requires at least: 5.8
 * WC requires at least: 5.0
 */

defined( 'ABSPATH' ) || exit;

class Merchant_Schema_Fix {

    private static $instance = null;

    public static function instance() {
        if ( null === self::$instance ) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct() {
        add_action( 'template_redirect', [ $this, 'start_output_buffer' ], 1 );
        add_action( 'shutdown', [ $this, 'end_output_buffer' ], 0 );
    }

    public function start_output_buffer() {
        if ( ! $this->should_process() ) {
            return;
        }
        ob_start( [ $this, 'fix_schema_output' ] );
    }

    public function end_output_buffer() {
        if ( ob_get_level() > 0 ) {
            ob_end_flush();
        }
    }

    private function should_process() {
        if ( is_admin() || wp_doing_ajax() || wp_doing_cron() ) {
            return false;
        }
        if ( function_exists( 'is_product' ) && is_product() ) {
            return true;
        }
        if ( function_exists( 'is_shop' ) && is_shop() ) {
            return true;
        }
        return false;
    }

    public function fix_schema_output( $buffer ) {
        if ( empty( $buffer ) ) {
            return $buffer;
        }

        $pattern = '/<script[^>]*type=["\']application\/ld\+json["\'][^>]*>(.*?)<\/script>/si';

        $buffer = preg_replace_callback( $pattern, function( $matches ) {
            $json = trim( $matches[1] );
            
            $data = json_decode( $json, true );
            if ( json_last_error() !== JSON_ERROR_NONE || ! is_array( $data ) ) {
                return $matches[0];
            }

            $modified = false;

            if ( isset( $data['@graph'] ) && is_array( $data['@graph'] ) ) {
                foreach ( $data['@graph'] as &$item ) {
                    if ( $this->fix_product_schema( $item ) ) {
                        $modified = true;
                    }
                }
                unset( $item );
            } elseif ( isset( $data['@type'] ) ) {
                if ( $this->fix_product_schema( $data ) ) {
                    $modified = true;
                }
            }

            if ( ! $modified ) {
                return $matches[0];
            }

            $new_json = wp_json_encode( $data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE );
            return '<script type="application/ld+json">' . $new_json . '</script>';
        }, $buffer );

        return $buffer;
    }

    private function fix_product_schema( &$schema ) {
        if ( ! is_array( $schema ) ) {
            return false;
        }

        $type = $schema['@type'] ?? '';
        if ( $type !== 'Product' && $type !== 'ProductGroup' ) {
            return false;
        }

        if ( ! isset( $schema['offers'] ) ) {
            return false;
        }

        $modified = false;

        if ( isset( $schema['offers'][0] ) ) {
            foreach ( $schema['offers'] as &$offer ) {
                if ( $this->fix_offer( $offer ) ) {
                    $modified = true;
                }
            }
            unset( $offer );
        } elseif ( isset( $schema['offers']['@type'] ) ) {
            if ( $this->fix_offer( $schema['offers'] ) ) {
                $modified = true;
            }
        }

        return $modified;
    }

    private function fix_offer( &$offer ) {
        if ( ! is_array( $offer ) ) {
            return false;
        }

        $modified = false;

        // FIX 1: Convert priceSpecification to direct price/priceCurrency
        if ( isset( $offer['priceSpecification'] ) ) {
            $spec = $offer['priceSpecification'];
            if ( isset( $spec[0] ) ) {
                $spec = $spec[0];
            }

            if ( ! empty( $spec['price'] ) && ! isset( $offer['price'] ) ) {
                $offer['price'] = $spec['price'];
                $modified = true;
            }
            if ( ! empty( $spec['priceCurrency'] ) && ! isset( $offer['priceCurrency'] ) ) {
                $offer['priceCurrency'] = $spec['priceCurrency'];
                $modified = true;
            }
            if ( ! empty( $spec['validThrough'] ) && ! isset( $offer['priceValidUntil'] ) ) {
                $offer['priceValidUntil'] = $spec['validThrough'];
                $modified = true;
            }

            unset( $offer['priceSpecification'] );
            $modified = true;
        }

        // FIX 2: Change http://schema.org to https://schema.org in availability
        if ( isset( $offer['availability'] ) && strpos( $offer['availability'], 'http://schema.org/' ) !== false ) {
            $offer['availability'] = str_replace( 'http://schema.org/', 'https://schema.org/', $offer['availability'] );
            $modified = true;
        }

        // FIX 3: Ensure priceValidUntil exists if price exists
        if ( isset( $offer['price'] ) && ! isset( $offer['priceValidUntil'] ) ) {
            $offer['priceValidUntil'] = date( 'Y-m-d', strtotime( '+1 year' ) );
            $modified = true;
        }

        // FIX 4: Ensure itemCondition uses https
        if ( isset( $offer['itemCondition'] ) && strpos( $offer['itemCondition'], 'http://schema.org/' ) !== false ) {
            $offer['itemCondition'] = str_replace( 'http://schema.org/', 'https://schema.org/', $offer['itemCondition'] );
            $modified = true;
        }

        return $modified;
    }
}

add_action( 'plugins_loaded', function() {
    Merchant_Schema_Fix::instance();
} );
