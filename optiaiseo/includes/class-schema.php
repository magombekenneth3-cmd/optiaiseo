<?php
defined( 'ABSPATH' ) || exit;

class OptiAISEO_Schema {

	public static function init(): void {
		add_action( 'wp_head',   [ __CLASS__, 'output_schema' ], 5 );
		add_action( 'save_post', [ __CLASS__, 'maybe_auto_inject' ], 20 );
	}

	public static function output_schema(): void {
		if ( ! is_singular( 'post' ) ) return;

		$schema = get_post_meta( get_the_ID(), '_optiaiseo_injected_schema', true );
		if ( ! $schema ) return;

		if ( preg_match_all( '#<script[^>]+type=["\']application/ld\+json["\'][^>]*>([\s\S]*?)</script>#i', $schema, $matches ) ) {
			foreach ( $matches[1] as $json_str ) {
				$decoded = json_decode( trim( $json_str ), true );
				if ( $decoded ) {
					echo '<script type="application/ld+json">' . wp_json_encode( $decoded, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) . '</script>' . "\n";
				}
			}
		}
	}

	public static function maybe_auto_inject( int $post_id ): void {
		if ( ! get_option( 'optiaiseo_auto_inject_schema' ) ) return;
		if ( get_post_status( $post_id ) !== 'publish' ) return;
		if ( get_post_meta( $post_id, '_optiaiseo_injected_schema', true ) ) return;

		$suggested = get_post_meta( $post_id, '_optiaiseo_schema_html', true );
		if ( $suggested ) {
			update_post_meta( $post_id, '_optiaiseo_injected_schema', $suggested );
		}
	}
}
