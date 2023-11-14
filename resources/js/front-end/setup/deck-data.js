const cardData = [
    [4, 'comfey', 'resources/card-scans/comfey.webp', 'pokemon'],
    [2, 'sableye', 'resources/card-scans/sableye.webp', 'pokemon'],
    [1, 'cramorant', 'resources/card-scans/cramorant.webp', 'pokemon'],
    [1, 'kyogre', 'resources/card-scans/kyogre.webp', 'pokemon'],
    [1, 'pidgeotV', 'resources/card-scans/pidgeotV.webp', 'pokemon'],
    [1, 'manaphy', 'resources/card-scans/manaphy.webp', 'pokemon'],
    [1, 'radiantGreninja', 'resources/card-scans/radiantGreninja.webp', 'pokemon'],
    [1, 'zamazenta', 'resources/card-scans/zamazenta.webp', 'pokemon'],
    [4, 'metal', 'resources/card-scans/metal.webp', 'energy'],
    [4, 'water', 'resources/card-scans/water.webp', 'energy'],
    [3, 'psychic', 'resources/card-scans/psychic.webp', 'energy'],
    [4, 'colress\'sExperiment', 'resources/card-scans/colress\'sExperiment.webp', 'supporter'],
    [4, 'battleVipPass', 'resources/card-scans/battleVipPass.webp', 'item'],
    [4, 'mirageGate', 'resources/card-scans/mirageGate.webp', 'item'],
    [4, 'switchCart', 'resources/card-scans/switchCart.webp', 'item'],
    [3, 'escapeRope', 'resources/card-scans/escapeRope.webp', 'item'],
    [4, 'nestBall', 'resources/card-scans/nestBall.jpg', 'item'],
    [3, 'superRod', 'resources/card-scans/superRod.webp', 'item'],
    [2, 'energyRecycler', 'resources/card-scans/energyRecycler.webp', 'item'],
    [1, 'lostVacuum', 'resources/card-scans/lostVacuum.webp', 'item'],
    [1, 'echoingHorn', 'resources/card-scans/echoingHorn.jpg', 'item'],
    [1, 'hisuianHeavyBall', 'resources/card-scans/hisuianHeavyBall.webp', 'item'],
    [1, 'roxanne', 'resources/card-scans/roxanne.webp', 'supporter'],
    [1, 'artazon', 'resources/card-scans/artazon.webp', 'stadium'],
    [1, 'pokestop', 'resources/card-scans/pokestop.webp', 'stadium'],
    [1, 'beachCourt', 'resources/card-scans/beachCourt.webp', 'stadium'],
    [2, 'forestSealStone', 'resources/card-scans/forestSealStone.webp', 'tool']
];

export const deckData = cardData.map(card => assembleCard(...card));

function assembleCard(quantity, name, imageURL, type){
    const imageAttributes = {
        src: imageURL,
        alt: name,
        draggable: true,
        click: 'imageClick',
        dragstart: 'dragStart',
        dragover: 'dragOver',
        dragend: 'dragEnd',
        id: 'card'
    };

    const cardAttributes = {
        name: name,
        type: type
    };

    const oppImageAttributes = (({ src, alt, style, layer, relative, target }) => 
    ({ src, alt, style, layer, relative, target }))(imageAttributes);

    const oppRawImageAttributes = JSON.stringify(oppImageAttributes);
    const rawCardAttributes = JSON.stringify(cardAttributes);
    const rawImageAttributes = JSON.stringify(imageAttributes);

    return [quantity, rawCardAttributes, rawImageAttributes, oppRawImageAttributes];
}
