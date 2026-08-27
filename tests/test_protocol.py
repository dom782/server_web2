def test_protocol_shape():
    msg = {"version":1,"id":"x","type":"request","action":"article.get","payload":{"cod_art":"IGLU27"}}
    assert msg["version"] == 1 and msg["type"] == "request"
