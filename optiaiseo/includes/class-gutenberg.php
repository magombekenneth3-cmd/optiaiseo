<?php
defined( 'ABSPATH' ) || exit;

class OptiAISEO_Gutenberg {

	public static function init(): void {
		add_action( 'enqueue_block_editor_assets', [ __CLASS__, 'enqueue' ] );
		add_action( 'rest_api_init',               [ __CLASS__, 'register_meta' ] );
	}

	public static function register_meta(): void {
		$keys = [
			'_optiaiseo_score', '_optiaiseo_grade', '_optiaiseo_gsov',
			'_optiaiseo_checks', '_optiaiseo_schema_html',
			'_optiaiseo_injected_schema', '_optiaiseo_synced_at',
		];
		foreach ( $keys as $key ) {
			register_post_meta( 'post', $key, [
				'show_in_rest'  => true,
				'single'        => true,
				'type'          => 'string',
				'auth_callback' => fn() => current_user_can( 'edit_posts' ),
			] );
		}
	}

	public static function enqueue(): void {
		if ( ! get_option( 'optiaiseo_api_key' ) ) return;

		wp_enqueue_script(
			'optiaiseo-editor',
			OPTIAISEO_PLUGIN_URL . 'assets/editor.js',
			[ 'wp-plugins', 'wp-edit-post', 'wp-element', 'wp-components', 'wp-data', 'wp-i18n' ],
			OPTIAISEO_VERSION,
			true
		);

		wp_localize_script( 'optiaiseo-editor', 'optiaiseoData', [
			'ajaxUrl'      => admin_url( 'admin-ajax.php' ),
			'nonces'       => [
				'refresh' => wp_create_nonce( 'optiaiseo_refresh' ),
				'schema'  => wp_create_nonce( 'optiaiseo_schema' ),
			],
			'siteId'       => get_option( 'optiaiseo_site_id' ),
			'dashboardUrl' => 'https://optiaiseo.com/dashboard',
		] );

		wp_add_inline_style( 'wp-edit-post', '
			.oaiseo-score-row { display:flex; align-items:center; gap:12px; padding:12px 16px; border-bottom:1px solid #e0e0e0; }
			.oaiseo-big-score { font-size:32px; font-weight:700; line-height:1; }
			.oaiseo-grade-pill { font-size:11px; font-weight:700; padding:3px 8px; border-radius:3px; }
			.oaiseo-grade-a { background:#d7f7e0; color:#0a7227; }
			.oaiseo-grade-b { background:#d7eeff; color:#0a4b8a; }
			.oaiseo-grade-c { background:#fff3cd; color:#7a4700; }
			.oaiseo-grade-d, .oaiseo-grade-f { background:#fde8e8; color:#8a0a0a; }
			.oaiseo-check { font-size:12px; padding:6px 16px; border-bottom:1px solid #f0f0f0; display:flex; gap:8px; }
			.oaiseo-check-fail { color:#cc1818; }
			.oaiseo-actions { padding:12px 16px; display:flex; flex-direction:column; gap:8px; }
			.oaiseo-btn { padding:6px 12px; font-size:12px; cursor:pointer; border-radius:3px; border:1px solid #ddd; background:#fff; }
			.oaiseo-btn-primary { background:#00a32a; color:#fff; border-color:#00a32a; font-weight:600; }
			.oaiseo-btn-primary:hover { background:#007a1f; border-color:#007a1f; }
			.oaiseo-empty { padding:12px 16px; color:#757575; font-size:12px; }
		' );
	}
}
