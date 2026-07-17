-- Backfill productId and imageUrl into purchase_history.items_json for product receipts.
-- Requires MySQL 8.0+ for JSON_TABLE and JSON_ARRAYAGG.

UPDATE purchase_history ph
INNER JOIN (
    SELECT
        source.history_id,
        JSON_ARRAYAGG(
            JSON_MERGE_PATCH(
                source.item_doc,
                JSON_OBJECT(
                    'productId', COALESCE(source.existing_product_id, source.service_id, 0),
                    'imageUrl', COALESCE(source.existing_image_url, source.product_image_url, '')
                )
            )
            ORDER BY source.item_index
        ) AS normalized_items_json
    FROM (
        SELECT
            ph2.history_id,
            jt.item_index,
            jt.item_doc,
            NULLIF(jt.product_id, 0) AS existing_product_id,
            NULLIF(jt.service_id, 0) AS service_id,
            NULLIF(jt.image_url, '') AS existing_image_url,
            p.image_url AS product_image_url
        FROM purchase_history ph2
        INNER JOIN JSON_TABLE(
            ph2.items_json,
            '$[*]' COLUMNS (
                item_index FOR ORDINALITY,
                item_doc JSON PATH '$',
                product_id INT PATH '$.productId' NULL ON EMPTY,
                service_id INT PATH '$.serviceId' NULL ON EMPTY,
                image_url VARCHAR(1024) PATH '$.imageUrl' NULL ON EMPTY
            )
        ) AS jt
            ON TRUE
        LEFT JOIN products p
            ON p.product_id = COALESCE(NULLIF(jt.product_id, 0), NULLIF(jt.service_id, 0))
        WHERE ph2.purchase_type = 'product'
            AND JSON_VALID(ph2.items_json)
    ) AS source
    GROUP BY source.history_id
) AS payload
    ON payload.history_id = ph.history_id
SET ph.items_json = payload.normalized_items_json
WHERE ph.purchase_type = 'product'
    AND JSON_VALID(ph.items_json);